using System.Diagnostics;
using NAudio.CoreAudioApi;
using NAudio.Wave;

public sealed record WasapiPcmFormat(
    string FfmpegSampleFormat,
    int SampleRate,
    int Channels,
    int BlockAlign,
    int AverageBytesPerSecond,
    byte SilenceByte)
{
    public static WasapiPcmFormat FromWaveFormat(WaveFormat sourceFormat)
    {
        var format = sourceFormat is WaveFormatExtensible extensible
            ? extensible.ToStandardWaveFormat()
            : sourceFormat;

        var ffmpegFormat = (format.Encoding, format.BitsPerSample) switch
        {
            (WaveFormatEncoding.IeeeFloat, 32) => "f32le",
            (WaveFormatEncoding.IeeeFloat, 64) => "f64le",
            (WaveFormatEncoding.Pcm, 8) => "u8",
            (WaveFormatEncoding.Pcm, 16) => "s16le",
            (WaveFormatEncoding.Pcm, 24) => "s24le",
            (WaveFormatEncoding.Pcm, 32) => "s32le",
            _ => throw new InvalidOperationException(
                $"Unsupported WASAPI mix format: {sourceFormat}. " +
                "The render endpoint must expose PCM or IEEE-float audio.")
        };

        return new WasapiPcmFormat(
            ffmpegFormat,
            format.SampleRate,
            format.Channels,
            format.BlockAlign,
            format.AverageBytesPerSecond,
            format.Encoding == WaveFormatEncoding.Pcm && format.BitsPerSample == 8
                ? (byte)0x80
                : (byte)0x00);
    }
}

public sealed class WasapiLoopbackInput : IDisposable
{
    private static readonly TimeSpan PumpInterval = TimeSpan.FromMilliseconds(20);
    private static readonly TimeSpan MaximumBufferedAudio = TimeSpan.FromMilliseconds(500);

    private readonly ILogger logger;
    private readonly MMDeviceEnumerator deviceEnumerator;
    private readonly MMDevice device;
    private readonly WasapiLoopbackCapture capture;
    private readonly object bufferGate = new();
    private readonly Queue<byte[]> capturedPackets = [];
    private readonly TaskCompletionSource<Exception?> recordingStopped = new(
        TaskCreationOptions.RunContinuationsAsynchronously);
    private byte[]? currentPacket;
    private int currentPacketOffset;
    private int bufferedBytes;
    private int disposed;

    public WasapiPcmFormat Format { get; }
    public string DeviceName => device.FriendlyName;

    public WasapiLoopbackInput(string configuredDevice, ILogger logger)
    {
        if (!OperatingSystem.IsWindows())
        {
            throw new PlatformNotSupportedException(
                "The wasapi-loopback backend is available only on Windows");
        }

        this.logger = logger;
        deviceEnumerator = new MMDeviceEnumerator();
        MMDevice? selectedDevice = null;
        WasapiLoopbackCapture? activeCapture = null;
        try
        {
            selectedDevice = ResolveRenderDevice(deviceEnumerator, configuredDevice);
            activeCapture = new WasapiLoopbackCapture(selectedDevice);
            Format = WasapiPcmFormat.FromWaveFormat(activeCapture.WaveFormat);
            device = selectedDevice;
            capture = activeCapture;
            capture.DataAvailable += CaptureDataAvailable;
            capture.RecordingStopped += CaptureRecordingStopped;
        }
        catch
        {
            activeCapture?.Dispose();
            selectedDevice?.Dispose();
            deviceEnumerator.Dispose();
            throw;
        }
    }

    public async Task PumpAsync(Stream destination, CancellationToken cancellationToken)
    {
        ObjectDisposedException.ThrowIf(Volatile.Read(ref disposed) != 0, this);
        logger.LogInformation(
            "Capturing Windows render endpoint {DeviceName} ({SampleRate} Hz, {Channels} channel(s), {SampleFormat})",
            DeviceName,
            Format.SampleRate,
            Format.Channels,
            Format.FfmpegSampleFormat);

        capture.StartRecording();
        var bytesPerInterval = Math.Max(
            Format.BlockAlign,
            Format.AverageBytesPerSecond / 50 / Format.BlockAlign * Format.BlockAlign);
        var outputBuffer = new byte[bytesPerInterval];
        using var timer = new PeriodicTimer(PumpInterval);
        var clock = Stopwatch.StartNew();
        long bytesWritten = 0;

        try
        {
            while (await timer.WaitForNextTickAsync(cancellationToken))
            {
                if (recordingStopped.Task.IsCompleted)
                {
                    var error = await recordingStopped.Task;
                    throw error is null
                        ? new IOException($"WASAPI loopback capture stopped for {DeviceName}")
                        : new IOException($"WASAPI loopback capture failed for {DeviceName}", error);
                }

                // Pace raw PCM against wall time. WASAPI does not emit packets while a
                // render endpoint is silent, so zero-fill those gaps to keep FFmpeg and
                // every HTTP subscriber alive. Catching up after a delayed timer tick
                // also avoids gradually increasing A/V skew.
                var targetBytes = AlignDown(
                    (long)(clock.Elapsed.TotalSeconds * Format.AverageBytesPerSecond),
                    Format.BlockAlign);
                do
                {
                    var bytesDue = targetBytes - bytesWritten;
                    var count = (int)Math.Min(outputBuffer.Length, Math.Max(0, bytesDue));
                    count = (int)AlignDown(count, Format.BlockAlign);
                    if (count == 0) break;

                    outputBuffer.AsSpan(0, count).Fill(Format.SilenceByte);
                    CopyCapturedAudio(outputBuffer.AsSpan(0, count));
                    await destination.WriteAsync(outputBuffer.AsMemory(0, count), cancellationToken);
                    bytesWritten += count;
                }
                while (bytesWritten < targetBytes);
            }
        }
        finally
        {
            try
            {
                capture.StopRecording();
            }
            catch (InvalidOperationException) { }
        }
    }

    private void CaptureDataAvailable(object? sender, WaveInEventArgs eventArgs)
    {
        if (eventArgs.BytesRecorded <= 0 || Volatile.Read(ref disposed) != 0) return;

        var packet = eventArgs.Buffer.AsSpan(0, eventArgs.BytesRecorded).ToArray();
        lock (bufferGate)
        {
            capturedPackets.Enqueue(packet);
            bufferedBytes += packet.Length;
            var maximumBytes = (int)(Format.AverageBytesPerSecond * MaximumBufferedAudio.TotalSeconds);

            // Drop the oldest whole packets if capture gets far ahead. Bounded latency
            // is more important for a live source than preserving already-stale audio.
            while (bufferedBytes > maximumBytes && capturedPackets.Count > 1)
            {
                bufferedBytes -= capturedPackets.Dequeue().Length;
            }
        }
    }

    private void CaptureRecordingStopped(object? sender, StoppedEventArgs eventArgs)
    {
        recordingStopped.TrySetResult(eventArgs.Exception);
    }

    private void CopyCapturedAudio(Span<byte> destination)
    {
        lock (bufferGate)
        {
            var destinationOffset = 0;
            while (destinationOffset < destination.Length)
            {
                if (currentPacket is null)
                {
                    if (!capturedPackets.TryDequeue(out currentPacket)) break;
                    currentPacketOffset = 0;
                }

                var count = Math.Min(
                    destination.Length - destinationOffset,
                    currentPacket.Length - currentPacketOffset);
                currentPacket.AsSpan(currentPacketOffset, count).CopyTo(destination[destinationOffset..]);
                destinationOffset += count;
                currentPacketOffset += count;
                bufferedBytes -= count;

                if (currentPacketOffset == currentPacket.Length)
                {
                    currentPacket = null;
                    currentPacketOffset = 0;
                }
            }
        }
    }

    private static MMDevice ResolveRenderDevice(
        MMDeviceEnumerator enumerator,
        string configuredDevice)
    {
        if (string.IsNullOrWhiteSpace(configuredDevice) ||
            configuredDevice.Equals("default", StringComparison.OrdinalIgnoreCase))
        {
            return enumerator.GetDefaultAudioEndpoint(DataFlow.Render, Role.Multimedia);
        }

        var endpoints = enumerator.EnumerateAudioEndPoints(DataFlow.Render, DeviceState.Active);
        MMDevice? selected = null;
        var availableNames = new List<string>();
        foreach (var endpoint in endpoints)
        {
            availableNames.Add(endpoint.FriendlyName);
            if (selected is null &&
                (endpoint.FriendlyName.Equals(configuredDevice, StringComparison.OrdinalIgnoreCase) ||
                 endpoint.ID.Equals(configuredDevice, StringComparison.OrdinalIgnoreCase)))
            {
                selected = endpoint;
            }
            else
            {
                endpoint.Dispose();
            }
        }

        return selected ?? throw new InvalidOperationException(
            $"Windows render endpoint '{configuredDevice}' was not found. Active endpoints: " +
            (availableNames.Count == 0 ? "none" : string.Join(", ", availableNames)));
    }

    private static long AlignDown(long value, int alignment) => value / alignment * alignment;

    public void Dispose()
    {
        if (Interlocked.Exchange(ref disposed, 1) != 0) return;
        capture.DataAvailable -= CaptureDataAvailable;
        capture.RecordingStopped -= CaptureRecordingStopped;
        try
        {
            capture.StopRecording();
        }
        catch (InvalidOperationException) { }
        capture.Dispose();
        device.Dispose();
        deviceEnumerator.Dispose();
    }
}
