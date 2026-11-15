"""Room/stream fader relationships; pre-fader routing remains independent of mutes."""


def fader_db(value):
    return (value * 40 - 30 if value >= .5 else value * 80 - 50 if value >= .25
            else value * 160 - 70 if value >= .0625 else value * 480 - 90)


def wire(db):
    if db <= -90:
        return 0.0
    if db >= 10:
        return 1.0
    return ((db + 30) / 40 if db >= -10 else (db + 50) / 80 if db >= -30
            else (db + 70) / 160 if db >= -60 else (db + 90) / 480)


def nominal_level(db, offset):
    return 0.0 if db == -120 else wire(db + offset)


def offset_level(value, offset):
    # A fader at minus infinity stays silent even with positive offset.
    return 0.0 if value == 0 else wire(fader_db(value) + offset)


def send_paths(cfg, strip):
    if strip == '/lr':
        return [f'/bus/{bus}/mix/fader' for bus in (cfg.livestream_bus, cfg.livestream_bus + 1)]
    return [f'{strip}/mix/{bus:02}/level' for bus in (cfg.livestream_bus, cfg.livestream_bus + 1)]


def balance_channels(cfg):
    return [strip for strip, role in cfg.roles.items() if role != "other"]


def balance_state(cfg):
    return {'offset_db': cfg.stream_offset_db, 'independent': list(cfg.independent_stream_levels),
            'bus': cfg.livestream_bus, 'channels': balance_channels(cfg),
            'enabled': cfg.room_enabled and cfg.livestream_enabled and bool(balance_channels(cfg))}


def manual_levels(cfg, commands):
    """Expand an operator batch before validating or writing any hardware values."""
    result = {}
    active = cfg.room_enabled and cfg.livestream_enabled and bool(balance_channels(cfg))
    for path, value in commands:
        result[path] = value
        if not active:
            continue
        for strip in [*balance_channels(cfg), '/lr']:
            room = strip + '/mix/fader'
            sends = send_paths(cfg, strip)
            offset = 0 if strip == '/lr' else cfg.stream_offset_db
            if path == room and strip not in cfg.independent_stream_levels:
                result.update({send: offset_level(value, offset) for send in sends})
            elif path in sends:
                # Remember the nominal stream level independently of the global offset.
                cfg.independent_stream_levels[strip] = -120 if value == 0 else fader_db(value) - offset
                result.update({send: value for send in sends})
    return result


def balance_commands(cfg, values, *, offset=None, resync=None):
    if not (cfg.room_enabled and cfg.livestream_enabled and balance_channels(cfg)):
        raise ValueError('Enable room and livestream control and map inputs first')
    if resync is not None and resync not in {*balance_channels(cfg), '/lr'}:
        raise ValueError('Choose a mapped channel or master to resync')
    if offset is not None:
        cfg.stream_offset_db = offset
    if resync:
        cfg.independent_stream_levels.pop(resync, None)
    strips = balance_channels(cfg) if offset is not None else [resync]
    result = {}
    for strip in strips:
        if strip in cfg.independent_stream_levels:
            level = nominal_level(cfg.independent_stream_levels[strip], 0 if strip == "/lr" else cfg.stream_offset_db)
        else:
            nominal = values.get(strip + '/mix/fader')
            if not isinstance(nominal, (float, int)):
                raise ValueError('Wait for room fader readbacks before changing balance')
            level = offset_level(nominal, 0 if strip == '/lr' else cfg.stream_offset_db)
        result.update({path: level for path in send_paths(cfg, strip)})
    return result
