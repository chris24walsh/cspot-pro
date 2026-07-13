# Plex media SSD recovery

The Plex host can retain a dead ext4 mount if the USB SSD briefly disconnects
and then returns under a different device name. The characteristic failure is:

- Plex itself remains healthy, but media will not play.
- `/mnt/plex-ssd/supervisor/share` returns `Input/output error`.
- `findmnt /mnt/plex-ssd` names a device that no longer exists, such as
  `/dev/sdb1`.
- `lsblk` shows the same filesystem UUID on a new device, such as `/dev/sdc1`.

Run the guarded recovery from this repository:

```bash
./scripts/recover-plex-media.sh
```

The script refuses to proceed unless it sees that exact stale-device pattern.
It stops Plex, unmounts the dead entry, runs a non-interactive ext4 repair,
mounts the reappeared device, reads one megabyte from a real media file, and
then restarts Plex. It uses the Plex container image for the privileged repair
because the normal SSH account does not have passwordless `sudo`.

If the SSD is absent, the old block device still exists, filesystem repair
fails, or no real media file can be read, the script leaves Plex stopped and
reports the problem. In those cases inspect the drive and cabling rather than
forcing recovery. A physical reconnect may still be required when the drive
does not reappear at all.

Defaults match the current host and may be overridden with `SSH_HOST`,
`REMOTE_ROOT`, `MEDIA_MOUNT`, and `MEDIA_UUID` environment variables.
