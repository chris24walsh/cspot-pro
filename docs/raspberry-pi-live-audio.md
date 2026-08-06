# Raspberry Pi live audio

For new installations with multiple inputs, prefer the portable
[`audio-bridge`](../audio-bridge/README.md). It captures only while CSpot is
consuming a source and uses the same configuration model on Windows and Linux.
The Icecast publisher below remains supported for existing single-input Pis.

CSpot can play and record a dedicated low-bandwidth audio stream independently
of the camera. A Raspberry Pi captures an ALSA input with FFmpeg and publishes
mono MP3 audio to Icecast. The API relays that stream to signed-in viewers, so
an internal HTTP source still works when CSpot itself is served over HTTPS.

## Hardware

- For room sound, use a class-compliant USB microphone.
- For the mixing desk, use a class-compliant USB audio interface with a true
  line input. Connect a desk record, matrix, or aux output to it with the
  appropriate RCA-to-interface cable.
- Do not connect a line-level RCA output directly to a microphone input. Start
  with the desk send low, avoid clipping, and use a ground-loop isolator if the
  feed hums. The Raspberry Pi analogue jack is an output, not an audio input.

## Pi setup

Install FFmpeg, ALSA tools, and Icecast on Raspberry Pi OS:

```bash
sudo apt update
sudo apt install alsa-utils ffmpeg icecast2
arecord -l
```

Configure Icecast with a strong source password and bind it only to the church
LAN or tailnet. Test the selected capture device before enabling the service:

```bash
arecord -D plughw:CARD=Device,DEV=0 -c 1 -r 48000 -f S16_LE -d 10 test.wav
aplay test.wav
```

Install the checked-in publisher and service:

```bash
sudo install -m 0755 scripts/rpi-audio-stream.sh /usr/local/bin/cspot-rpi-audio-stream
sudo install -m 0644 deploy/rpi-audio/cspot-audio-stream.service /etc/systemd/system/
sudo install -m 0600 deploy/rpi-audio/cspot-audio-stream.env.example /etc/cspot-audio-stream
sudoedit /etc/cspot-audio-stream
sudo useradd --system --no-create-home --groups audio cspot-audio
sudo systemctl daemon-reload
sudo systemctl enable --now cspot-audio-stream
sudo systemctl status cspot-audio-stream
```

Set `CSPOT_AUDIO_DEVICE` to the ALSA device tested above, for example
`plughw:CARD=Device,DEV=0`. Use two input channels for a stereo interface; CSpot
downmixes the stream to mono to keep speech bandwidth and archive size low.

## CSpot setup

In **Broadcast → Settings**, set **Live audio stream URL** to the listener URL
that the CSpot API container can reach, such as:

```text
http://192.168.1.40:8000/cspot.mp3
```

When a presentation output is live, viewers receive a Live service audio
player. The API refuses to open the configured microphone stream at other times.
If a camera is also configured, its audio is muted to avoid echo. Sermon
recording prefers this source and falls back to the camera audio track when the
dedicated source is empty.

Keep Icecast private, use synthetic credentials during testing, and do not put
the source password in the listener URL entered in CSpot.
