"""Gate only desk-input sends; channel switches and media remain independent."""


import asyncio


class DeskStreamGate:
    def __init__(self):
        self.initialized = False
        self.lock = asyncio.Lock()
        self.paths: set[str] = set()
        self.targets: dict[str, float] = {}

    def effective(self, path, value):
        return 0.0 if path in self.paths else value

    def remember(self, path, value):
        if path in self.paths:
            self.targets[path] = value

    def activate(self, targets):
        self.initialized = True
        self.targets = dict(targets)
        self.paths = set(targets)

    def release(self):
        self.initialized = True
        targets = self.targets.copy()
        self.paths.clear()
        self.targets.clear()
        return targets


def desk_send_paths(cfg):
    return {
        f"{strip}/mix/{bus:02}/level"
        for strip, role in cfg.roles.items()
        if role in {"pastor", "leader", "congregation", "worship", "ambience"}
        for bus in (cfg.livestream_bus, cfg.livestream_bus + 1)
    }


def desk_stream_control(cfg, mixer):
    paths = desk_send_paths(cfg)
    reason = None
    if "media" not in cfg.roles.values():
        reason = "Map the PC media input before using desk-only stream mute"
    elif not paths:
        reason = "Map microphone and instrument inputs first"
    elif not mixer.connected or mixer.syncing or mixer.recalling or mixer.startup_muting:
        reason = "Wait for a connected, synchronized desk"
    elif mixer.values.get(f"/config/buslink/{cfg.livestream_bus}-{cfg.livestream_bus + 1}") != 1:
        reason = "Link the configured livestream buses first"
    elif any(path not in mixer.values for path in paths):
        reason = "Wait for all desk stream send levels to be read"
    elif any(
        mixer.values.get(path.removesuffix("level") + "tap") != 3
        or mixer.values.get(path.removesuffix("level") + "grpon") != 0
        for path in paths
    ):
        reason = "Desk stream sends must be Pre fader with subgroup off"
    return {
        "muted": bool(mixer.stream_gate.paths),
        "confirmed": bool(mixer.stream_gate.paths) and all(
            mixer.values.get(path) == 0 for path in mixer.stream_gate.paths
        ),
        "ready": reason is None,
        "reason": reason,
    }
