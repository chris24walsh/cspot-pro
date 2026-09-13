# Sermon recording incident — 13 September 2026

The presenter showed a live sermon while the recording watcher reported
“Slideshow stopped”. The latest service session was live and scheduled, but
its position had no output owner or active-output fields. The watcher treated
that as a departure even though a scheduled service does not require a local
output window.

The capture starting at 10:49:46 UTC disappeared when its countdown expired.
The attempted deadline extension matched no row. The existing finalizer deletes
automatic captures when the retained departure offset is under 30 seconds,
regardless of how much audio was captured during the grace period. No surviving
copy of today's expired capture was found in recording storage, open deleted
file descriptors, or retained backups. The user confirmed there was no second
local recorder. Weekly backups predate today's service.

## Live containment

- The replacement recording started at 11:01:32 UTC. Its erroneous deadline was
  deferred to 14:02:49 UTC and its pending trim offset cleared. It must be stopped
  manually after the sermon. Copies of available source segments and metadata
  were preserved in `/app/storage/recording-recovery/20260913/`.
- Pre-service music was disabled after it played over the sermon. The
  `pre_service_audio_url` was cleared and `audio_scene_automation` disabled;
  the existing desk mix was retained. The original settings are saved in
  `audio-settings-before-emergency-mute.json` in the same recovery directory.
  Review/restore these settings only after the live service is finished.
- No production containers were restarted during containment.

## Recovered older audio

Six missing files were recovered from weekly backups, probed successfully, and
added to **Broadcast → Archived recordings**, with `Recovered` titles. They
were not published:

| Capture (UTC) | Duration |
| --- | --- |
| 3 July 19:31:52 | 11 seconds |
| 5 July 08:20:16 | 82 seconds |
| 5 July 10:33:10 | 304 seconds |
| 5 July 10:38:27 | 2,840 seconds |
| 13 August 18:24:02 | 240 seconds |
| 14 August 11:26:58 | 15 seconds |

Recovered originals and backup metadata remain under
`/srv/apps/backups/cspot/recovery-20260913/` on apps-host and
`/app/storage/recording-recovery/backups-20260913/` in persistent app storage.
The app's restored audio files are under `storage/recordings/recovered/`.
Some older captures may be tests; their original slide metadata was restored
where available, and absent metadata was not fabricated.

## Permanent correction

Recording follows the service session's live/ended lifecycle, independently of
output-window ownership. Presenter transitions use the same lifecycle rule.
Short automatic captures are archived with complete audio rather than deleted.
Before grace trimming, the full file and recording metadata are preserved in
`storage/recordings/recovery/<recording-id>/`; preservation failure skips trimming.

The change was validated with 75 recording/presentation tests in an isolated
container, including real FFmpeg trim and preservation checks. Deployment must
wait until the Sunday service and active recording have finished.
