# Archived software source mixer — 25 October 2026

Reference snapshots only; these files are not imported, built, or tested by the app.
They preserve the FFmpeg multi-input amix/limiter graph, ZMQ runtime gain control,
source faders, software scene editor, old routing, and original regression tests.
`backend/routes.py.txt` records the surrounding relay/settings implementation.

The live application accepts one program feed at unity gain. XR18 DSP handles
mixing and scene sends. Viewers prefer the shared go2rtc audio stream; the API
retains single-feed AAC/MP3 relays when no gateway is configured. Recording still
encodes the program feed with FFmpeg. Database source gains and scene JSON are
retained for recovery, but no longer affect program audio.

Migration 0076 chooses a unique source explicitly marked `desk` for legacy `mix`
selections. Ambiguous mixes become silent until an operator selects a source.
Existing explicit program selections and mute state are retained. Reintroducing
this archive requires a deliberate code/schema change and the former pyzmq
runtime dependency; it is not a selectable operating mode.

Room audio must use the desk's direct hardware outputs. Browser livestreams
still incur capture, codec, network and playback delay. No near-zero livestream
latency has been measured or promised.
