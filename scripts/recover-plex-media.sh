#!/usr/bin/env bash
set -euo pipefail

SSH_HOST="${SSH_HOST:-plex}"
REMOTE_ROOT="${REMOTE_ROOT:-/home/chris/plex}"
MEDIA_MOUNT="${MEDIA_MOUNT:-/mnt/plex-ssd}"
MEDIA_UUID="${MEDIA_UUID:-a4d0865c-fad4-4d66-a21b-c8cbca7eaf02}"

ssh "$SSH_HOST" bash -s -- "$REMOTE_ROOT" "$MEDIA_MOUNT" "$MEDIA_UUID" <<'REMOTE_SCRIPT'
set -euo pipefail

remote_root=$1
media_mount=$2
media_uuid=$3
share_path="$media_mount/supervisor/share"

if ls "$share_path" >/dev/null 2>&1; then
  echo "Media mount is readable; no recovery is needed."
  exit 0
fi

mounted_source=$(findmnt -nro SOURCE --target "$media_mount" 2>/dev/null || true)
replacement_device=$(lsblk -nrpo NAME,UUID | awk -v uuid="$media_uuid" '$2 == uuid { print $1; exit }')

if [[ -z "$mounted_source" ]]; then
  echo "Refusing recovery: $media_mount is not currently mounted." >&2
  exit 1
fi

if [[ -z "$replacement_device" ]]; then
  echo "Refusing recovery: no attached block device has media UUID $media_uuid." >&2
  echo "The SSD may need physical reconnection or replacement." >&2
  exit 1
fi

if [[ -b "$mounted_source" ]]; then
  echo "Refusing recovery: $mounted_source still exists, so this is not the known stale-device failure." >&2
  echo "Inspect the SSD and kernel logs before forcing an unmount." >&2
  exit 1
fi

echo "Recovering stale $mounted_source mount with $replacement_device."
cd "$remote_root"
docker compose stop plex

docker run --rm --privileged --pid=host --entrypoint /bin/sh \
  plexinc/pms-docker:latest -c '
    set -eu
    mount_point=$1
    device=$2
    nsenter -t 1 -m -- umount "$mount_point"
    set +e
    e2fsck -p "$device"
    fsck_status=$?
    set -e
    if [ "$fsck_status" -gt 1 ]; then
      echo "Filesystem check failed with status $fsck_status; Plex remains stopped." >&2
      exit "$fsck_status"
    fi
    nsenter -t 1 -m -- mount -t ext4 -o rw,relatime "$device" "$mount_point"
  ' recovery "$media_mount" "$replacement_device"

sample_file=$(find "$share_path/movies" "$share_path/tv" -type f -size +1M 2>/dev/null | head -1 || true)
if [[ -z "$sample_file" ]]; then
  echo "Remount completed, but no media file was found for verification; Plex remains stopped." >&2
  exit 1
fi

dd if="$sample_file" of=/dev/null bs=1M count=1 status=none
docker compose up -d plex
docker compose ps plex
echo "Media recovery completed and a real media file was read successfully."
REMOTE_SCRIPT
