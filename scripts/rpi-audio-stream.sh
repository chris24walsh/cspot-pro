#!/usr/bin/env bash
set -euo pipefail

: "${CSPOT_AUDIO_PUBLISH_URL:?Set CSPOT_AUDIO_PUBLISH_URL to the Icecast source URL}"

audio_device="${CSPOT_AUDIO_DEVICE:-default}"
audio_channels="${CSPOT_AUDIO_CHANNELS:-1}"
audio_bitrate="${CSPOT_AUDIO_BITRATE:-64k}"

exec ffmpeg \
  -hide_banner \
  -loglevel warning \
  -nostdin \
  -thread_queue_size 1024 \
  -f alsa \
  -channels "$audio_channels" \
  -i "$audio_device" \
  -ac 1 \
  -ar 48000 \
  -c:a libmp3lame \
  -b:a "$audio_bitrate" \
  -reservoir 0 \
  -content_type audio/mpeg \
  -f mp3 \
  "$CSPOT_AUDIO_PUBLISH_URL"
