using System.Collections.Concurrent;
using System.Diagnostics;
using System.Globalization;
using System.Threading.Channels;
using Microsoft.Extensions.Options;

var builder = WebApplication.CreateBuilder(args);
var bridgeSection = builder.Configuration.GetSection("AudioBridge");
builder.Services.Configure<AudioBridgeOptions>(bridgeSection);
var startupOptions = bridgeSection.Get<AudioBridgeOptions>() ?? new();
builder.WebHost.UseUrls(startupOptions.ListenUrl);
builder.Services.AddSingleton<AudioCaptureManager>();

var app = builder.Build();

static bool Authorized(HttpRequest request, AudioBridgeOptions options)
{
    if (string.IsNullOrWhiteSpace(options.AccessToken)) return true;
    var supplied = request.Query["token"].FirstOrDefault();
    if (string.IsNullOrEmpty(supplied) && request.Headers.Authorization.Count > 0)
    {
        supplied = request.Headers.Authorization.ToString().Replace("Bearer ", "", StringComparison.OrdinalIgnoreCase);
    }
    return string.Equals(supplied, options.AccessToken, StringComparison.Ordinal);
}

app.MapGet("/health", (AudioCaptureManager manager) => Results.Ok(new
{
    status = "ok",
    sources = manager.Status()
}));

app.MapGet("/api/sources", (HttpRequest request, IOptions<AudioBridgeOptions> configured, AudioCaptureManager manager) =>
    Authorized(request, configured.Value)
        ? Results.Ok(manager.Status())
        : Results.Unauthorized());

app.MapGet("/audio/{sourceId}.mp3", async (
    string sourceId,
    HttpContext context,
    IOptions<AudioBridgeOptions> configured,
    AudioCaptureManager manager) =>
{
    if (!Authorized(context.Request, configured.Value))
    {
        context.Response.StatusCode = StatusCodes.Status401Unauthorized;
        return;
    }

    var subscription = await manager.Subscribe(sourceId, context.RequestAborted);
    if (subscription is null)
    {
        context.Response.StatusCode = StatusCodes.Status404NotFound;
        return;
    }

    context.Response.StatusCode = StatusCodes.Status200OK;
    context.Response.ContentType = "audio/mpeg";
    context.Response.Headers.CacheControl = "no-store, no-cache";
    context.Response.Headers.Append("X-Accel-Buffering", "no");
    await context.Response.StartAsync(context.RequestAborted);

    await using (subscription)
    {
        await foreach (var chunk in subscription.Chunks.ReadAllAsync(context.RequestAborted))
        {
            await context.Response.Body.WriteAsync(chunk, context.RequestAborted);
            await context.Response.Body.FlushAsync(context.RequestAborted);
        }
    }
});

app.Run();

public sealed class AudioBridgeOptions
{
    public string ListenUrl { get; set; } = "http://0.0.0.0:8091";
    public string FfmpegPath { get; set; } = "ffmpeg";
    public string? AccessToken { get; set; }
    public int IdleTimeoutSeconds { get; set; } = 10;
    public List<AudioSourceOptions> Sources { get; set; } = [];
}

public sealed class AudioSourceOptions
{
    public string Id { get; set; } = "audio";
    public string Label { get; set; } = "Audio";
    public string Backend { get; set; } = OperatingSystem.IsWindows() ? "dshow" : "alsa";
    public string Device { get; set; } = "default";
    public int Channels { get; set; } = 1;
    public int BitrateKbps { get; set; } = 64;
    public double GainDb { get; set; }
}

public sealed class AudioCaptureManager(IOptions<AudioBridgeOptions> configured, ILoggerFactory loggerFactory) : IDisposable
{
    private readonly AudioBridgeOptions options = configured.Value;
    private readonly ConcurrentDictionary<string, SharedCapture> captures = new(StringComparer.OrdinalIgnoreCase);

    public IReadOnlyList<object> Status() => options.Sources.Select(source =>
    {
        captures.TryGetValue(source.Id, out var capture);
        return (object)new
        {
            source.Id,
            source.Label,
            source.Backend,
            active = capture?.Active ?? false,
            listeners = capture?.ListenerCount ?? 0,
            error = capture?.LastError
        };
    }).ToList();

    public Task<AudioSubscription?> Subscribe(string sourceId, CancellationToken cancellationToken)
    {
        var source = options.Sources.FirstOrDefault(candidate =>
            string.Equals(candidate.Id, sourceId, StringComparison.OrdinalIgnoreCase));
        if (source is null) return Task.FromResult<AudioSubscription?>(null);

        var capture = captures.GetOrAdd(source.Id, _ => new SharedCapture(
            source,
            options,
            loggerFactory.CreateLogger<SharedCapture>()));
        return Task.FromResult<AudioSubscription?>(capture.Subscribe(cancellationToken));
    }

    public void Dispose()
    {
        foreach (var capture in captures.Values) capture.Dispose();
    }
}

public sealed class AudioSubscription : IAsyncDisposable
{
    private readonly Action unsubscribe;
    private int disposed;
    public ChannelReader<byte[]> Chunks { get; }

    public AudioSubscription(ChannelReader<byte[]> chunks, Action unsubscribe)
    {
        Chunks = chunks;
        this.unsubscribe = unsubscribe;
    }

    public ValueTask DisposeAsync()
    {
        if (Interlocked.Exchange(ref disposed, 1) == 0) unsubscribe();
        return ValueTask.CompletedTask;
    }
}

public sealed class SharedCapture : IDisposable
{
    private readonly AudioSourceOptions source;
    private readonly AudioBridgeOptions options;
    private readonly ILogger logger;
    private readonly object gate = new();
    private readonly Dictionary<Guid, Channel<byte[]>> listeners = [];
    private Process? process;
    private WasapiLoopbackInput? loopbackInput;
    private CancellationTokenSource? loopbackCancellation;
    private CancellationTokenSource? idleCancellation;
    private bool disposed;

    public bool Active { get { lock (gate) return process is { HasExited: false }; } }
    public int ListenerCount { get { lock (gate) return listeners.Count; } }
    public string? LastError { get; private set; }

    public SharedCapture(AudioSourceOptions source, AudioBridgeOptions options, ILogger logger)
    {
        this.source = source;
        this.options = options;
        this.logger = logger;
    }

    public AudioSubscription Subscribe(CancellationToken cancellationToken)
    {
        var id = Guid.NewGuid();
        var channel = Channel.CreateBounded<byte[]>(new BoundedChannelOptions(16)
        {
            FullMode = BoundedChannelFullMode.DropOldest,
            SingleReader = true,
            SingleWriter = true
        });

        lock (gate)
        {
            ObjectDisposedException.ThrowIf(disposed, this);
            idleCancellation?.Cancel();
            idleCancellation?.Dispose();
            idleCancellation = null;
            listeners[id] = channel;
            EnsureStarted();
        }

        var registration = cancellationToken.Register(() => Unsubscribe(id));
        return new AudioSubscription(channel.Reader, () =>
        {
            registration.Dispose();
            Unsubscribe(id);
        });
    }

    private void EnsureStarted()
    {
        if (process is { HasExited: false }) return;

        WasapiLoopbackInput? pendingLoopback = null;
        Process? startedProcess = null;
        try
        {
            if (source.Backend.Equals("wasapi-loopback", StringComparison.OrdinalIgnoreCase))
            {
                pendingLoopback = new WasapiLoopbackInput(source.Device, logger);
            }

            var startInfo = new ProcessStartInfo(options.FfmpegPath)
            {
                UseShellExecute = false,
                RedirectStandardInput = pendingLoopback is not null,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true
            };
            foreach (var argument in FfmpegArguments(source, pendingLoopback?.Format))
            {
                startInfo.ArgumentList.Add(argument);
            }

            startedProcess = new Process { StartInfo = startInfo, EnableRaisingEvents = true };
            process = startedProcess;
            startedProcess.Exited += (_, _) => CaptureExited(startedProcess);
            startedProcess.Start();
            if (pendingLoopback is not null)
            {
                var activeLoopback = pendingLoopback;
                pendingLoopback = null;
                var activeCancellation = new CancellationTokenSource();
                var cancellationToken = activeCancellation.Token;
                loopbackInput = activeLoopback;
                loopbackCancellation = activeCancellation;
                _ = Task.Run(() => FeedLoopback(
                    startedProcess,
                    activeLoopback,
                    cancellationToken));
            }
            LastError = null;
            _ = Task.Run(() => ReadAudio(startedProcess));
            _ = Task.Run(() => ReadErrors(startedProcess));
            logger.LogInformation("Started audio source {SourceId} for {Listeners} listener(s)", source.Id, listeners.Count);
        }
        catch (Exception error)
        {
            LastError = error.Message;
            pendingLoopback?.Dispose();
            loopbackCancellation?.Cancel();
            DetachLoopback()?.Dispose();
            loopbackCancellation?.Dispose();
            loopbackCancellation = null;
            if (startedProcess is not null)
            {
                try
                {
                    if (startedProcess.HasExited is false) startedProcess.Kill(entireProcessTree: true);
                }
                catch (InvalidOperationException) { }
                startedProcess.Dispose();
            }
            process = null;
            CompleteListeners(error);
        }
    }

    private async Task FeedLoopback(
        Process activeProcess,
        WasapiLoopbackInput activeLoopback,
        CancellationToken cancellationToken)
    {
        try
        {
            await activeLoopback.PumpAsync(activeProcess.StandardInput.BaseStream, cancellationToken);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { }
        catch (Exception error)
        {
            lock (gate)
            {
                if (ReferenceEquals(process, activeProcess)) LastError = error.Message;
            }
            logger.LogWarning(error, "WASAPI loopback source {SourceId} stopped", source.Id);
        }
        finally
        {
            try
            {
                activeProcess.StandardInput.Close();
            }
            catch (InvalidOperationException) { }
        }
    }

    private async Task ReadAudio(Process activeProcess)
    {
        var buffer = new byte[2048];
        try
        {
            while (true)
            {
                var count = await activeProcess.StandardOutput.BaseStream.ReadAsync(buffer);
                if (count <= 0) break;
                var chunk = buffer[..count].ToArray();
                lock (gate)
                {
                    foreach (var listener in listeners.Values) listener.Writer.TryWrite(chunk);
                }
            }
        }
        catch (Exception error) when (error is IOException or ObjectDisposedException)
        {
            logger.LogDebug(error, "Audio source {SourceId} stopped", source.Id);
        }
    }

    private async Task ReadErrors(Process activeProcess)
    {
        var errors = await activeProcess.StandardError.ReadToEndAsync();
        if (!string.IsNullOrWhiteSpace(errors)) LastError = errors.Trim().Split('\n').Last().Trim();
    }

    private void CaptureExited(Process exitedProcess)
    {
        WasapiLoopbackInput? exitedLoopback = null;
        CancellationTokenSource? exitedCancellation = null;
        lock (gate)
        {
            if (ReferenceEquals(process, exitedProcess))
            {
                process = null;
                exitedLoopback = DetachLoopback();
                exitedCancellation = loopbackCancellation;
                loopbackCancellation = null;
                if (!disposed && listeners.Count > 0)
                {
                    LastError ??= $"FFmpeg exited with code {exitedProcess.ExitCode}";
                    CompleteListeners(new IOException(LastError));
                }
            }
        }
        exitedCancellation?.Cancel();
        exitedCancellation?.Dispose();
        exitedLoopback?.Dispose();
        exitedProcess.Dispose();
    }

    private void Unsubscribe(Guid id)
    {
        lock (gate)
        {
            if (!listeners.Remove(id, out var channel)) return;
            channel.Writer.TryComplete();
            if (listeners.Count > 0 || disposed) return;

            idleCancellation = new CancellationTokenSource();
            var token = idleCancellation.Token;
            _ = Task.Run(async () =>
            {
                try
                {
                    await Task.Delay(TimeSpan.FromSeconds(Math.Max(0, options.IdleTimeoutSeconds)), token);
                    lock (gate)
                    {
                        if (!token.IsCancellationRequested && listeners.Count == 0) StopCapture();
                    }
                }
                catch (OperationCanceledException) { }
            }, token);
        }
    }

    private void CompleteListeners(Exception error)
    {
        foreach (var listener in listeners.Values) listener.Writer.TryComplete(error);
        listeners.Clear();
    }

    private void StopCapture()
    {
        var activeProcess = process;
        process = null;
        var activeLoopback = DetachLoopback();
        var activeCancellation = loopbackCancellation;
        loopbackCancellation = null;
        activeCancellation?.Cancel();
        activeCancellation?.Dispose();
        activeLoopback?.Dispose();
        if (activeProcess is null) return;
        try
        {
            if (!activeProcess.HasExited) activeProcess.Kill(entireProcessTree: true);
        }
        catch (InvalidOperationException) { }
        logger.LogInformation("Stopped idle audio source {SourceId}", source.Id);
    }

    private WasapiLoopbackInput? DetachLoopback()
    {
        var activeLoopback = loopbackInput;
        loopbackInput = null;
        return activeLoopback;
    }

    internal static IEnumerable<string> FfmpegArguments(
        AudioSourceOptions source,
        WasapiPcmFormat? loopbackFormat = null)
    {
        yield return "-hide_banner";
        yield return "-loglevel";
        yield return "warning";
        if (loopbackFormat is null) yield return "-nostdin";
        yield return "-thread_queue_size";
        yield return "1024";
        if (source.Backend.Equals("dshow", StringComparison.OrdinalIgnoreCase))
        {
            yield return "-f";
            yield return "dshow";
            yield return "-audio_buffer_size";
            yield return "50";
            yield return "-i";
            yield return $"audio={source.Device}";
        }
        else if (source.Backend.Equals("alsa", StringComparison.OrdinalIgnoreCase))
        {
            yield return "-f";
            yield return "alsa";
            yield return "-channels";
            yield return Math.Max(1, source.Channels).ToString(CultureInfo.InvariantCulture);
            yield return "-i";
            yield return source.Device;
        }
        else if (source.Backend.Equals("wasapi-loopback", StringComparison.OrdinalIgnoreCase))
        {
            if (loopbackFormat is null)
            {
                throw new InvalidOperationException("WASAPI loopback capture format was not initialized");
            }
            yield return "-f";
            yield return loopbackFormat.FfmpegSampleFormat;
            yield return "-ar";
            yield return loopbackFormat.SampleRate.ToString(CultureInfo.InvariantCulture);
            yield return "-ac";
            yield return loopbackFormat.Channels.ToString(CultureInfo.InvariantCulture);
            yield return "-i";
            yield return "pipe:0";
        }
        else
        {
            throw new InvalidOperationException($"Unsupported capture backend: {source.Backend}");
        }
        yield return "-vn";
        yield return "-ac";
        yield return "1";
        yield return "-ar";
        yield return "48000";
        if (Math.Abs(source.GainDb) > 0.01)
        {
            yield return "-af";
            yield return $"volume={source.GainDb.ToString(CultureInfo.InvariantCulture)}dB";
        }
        yield return "-c:a";
        yield return "libmp3lame";
        yield return "-b:a";
        yield return $"{Math.Clamp(source.BitrateKbps, 32, 320)}k";
        yield return "-reservoir";
        yield return "0";
        yield return "-flush_packets";
        yield return "1";
        yield return "-write_xing";
        yield return "0";
        yield return "-f";
        yield return "mp3";
        yield return "pipe:1";
    }

    public void Dispose()
    {
        lock (gate)
        {
            disposed = true;
            idleCancellation?.Cancel();
            CompleteListeners(new ObjectDisposedException(nameof(SharedCapture)));
            StopCapture();
        }
    }
}
