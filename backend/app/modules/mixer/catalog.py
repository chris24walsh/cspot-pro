"""XR18 OSC parameter metadata. Values on the wire are normalized unless integer/string."""

PARAMETERS: dict[str, dict] = {}
STRIPS = (
    [
        {"id": f"/ch/{i:02}", "name": f"Ch {i}", "kind": "input", "meter": i - 1}
        for i in range(1, 17)
    ]
    + [{"id": "/rtn/aux", "name": "Aux 17/18", "kind": "aux", "meter": 16}]
    + [
        {"id": f"/rtn/{i}", "name": f"FX {i} return", "kind": "return", "meter": 18 + (i - 1) * 2}
        for i in range(1, 5)
    ]
    + [
        {"id": f"/bus/{i}", "name": f"Bus {i}", "kind": "bus", "meter": 26 + i - 1}
        for i in range(1, 7)
    ]
    + [
        {"id": f"/fxsend/{i}", "name": f"FX {i} send", "kind": "fxsend", "meter": 32 + i - 1}
        for i in range(1, 5)
    ]
    + [{"id": "/lr", "name": "Main LR", "kind": "main", "meter": 36}]
    + [{"id": f"/dca/{i}", "name": f"DCA {i}", "kind": "dca", "meter": -1} for i in range(1, 5)]
)


def add(path, label, group, kind="float", lo=0, hi=1, unit="", scale="linear", options=None):
    PARAMETERS[path] = dict(
        path=path,
        label=label,
        group=group,
        kind=kind,
        min=lo,
        max=hi,
        unit=unit,
        scale=scale,
        options=options,
    )


def toggle(path, label, group):
    add(path, label, group, "int", options=["Off", "On"])


def choice(path, label, group, options):
    add(path, label, group, "int", hi=len(options) - 1, options=options)


for strip in STRIPS:
    p, k = strip["id"], strip["kind"]
    add(p + "/config/name", "Name", "Setup", "string")
    choice(
        p + "/config/color",
        "Color",
        "Setup",
        [
            "None",
            "Red",
            "Green",
            "Yellow",
            "Blue",
            "Magenta",
            "Cyan",
            "White",
            "Red inverted",
            "Green inverted",
            "Yellow inverted",
            "Blue inverted",
            "Magenta inverted",
            "Cyan inverted",
            "White inverted",
            "Black",
        ],
    )
    mix = p if k == "dca" else p + "/mix"
    toggle(mix + "/on", "Channel on", "Mix")
    add(mix + "/fader", "Level", "Mix", lo=-90, hi=10, unit="dB", scale="fader")
    if k == "dca":
        continue
    if k in ("input", "aux", "return", "bus", "main"):
        add(p + "/mix/pan", "Pan / balance", "Mix", lo=-100, hi=100)
    if k in ("input", "aux", "return"):
        toggle(p + "/mix/lr", "Main LR assignment", "Mix")
    if k in ("input", "aux", "return", "bus"):
        add(p + "/grp/dca", "DCA membership bitmask", "Groups", "int", hi=15)
        add(p + "/grp/mute", "Mute group bitmask", "Groups", "int", hi=15)
    if k in ("input", "aux"):
        add(p + "/config/insrc", "Analog input source (0 based)", "Input", "int", hi=17)
        add(p + "/config/rtnsrc", "USB return source (0 based)", "Input", "int", hi=17)
        toggle(p + "/preamp/rtnsw", "Use USB return", "Input")
        add(p + "/preamp/rtntrim", "USB trim", "Input", lo=-18, hi=18, unit="dB")
        toggle(p + "/preamp/invert", "Invert polarity", "Input")
        toggle(p + "/preamp/hpon", "High pass", "Input")
        add(
            p + "/preamp/hpf", "High pass frequency", "Input", lo=20, hi=400, unit="Hz", scale="log"
        )
    if k == "input":
        n = int(p.rsplit("/", 1)[1])
        add(f"/headamp/{n:02}/gain", "Preamp gain", "Headamp", lo=-12, hi=60, unit="dB")
        toggle(f"/headamp/{n:02}/phantom", "48V phantom", "Headamp")
        choice(p + "/automix/group", "Automix group", "Groups", ["Off", "X", "Y"])
        add(p + "/automix/weight", "Automix weight", "Groups", lo=-12, hi=12, unit="dB")
        toggle(p + "/gate/on", "Gate enabled", "Gate")
        choice(p + "/gate/mode", "Mode", "Gate", ["Exp 2", "Exp 3", "Exp 4", "Gate", "Duck"])
        for suffix, label, lo, hi, scale, unit in [
            ("thr", "Threshold", -80, 0, "linear", "dB"),
            ("range", "Range", 3, 60, "linear", "dB"),
            ("attack", "Attack", 0, 120, "linear", "ms"),
            ("hold", "Hold", 0.02, 2000, "log", "ms"),
            ("release", "Release", 5, 4000, "log", "ms"),
        ]:
            add(p + "/gate/" + suffix, label, "Gate", lo=lo, hi=hi, scale=scale, unit=unit)
    if k in ("input", "aux", "return", "bus", "main"):
        toggle(p + "/eq/on", "EQ enabled", "EQ")
        for b in range(1, (6 if k in ("bus", "main") else 4) + 1):
            q = p + f"/eq/{b}"
            choice(
                q + "/type",
                f"Band {b} type",
                "EQ",
                ["Low cut", "Low shelf", "PEQ", "Vintage EQ", "High shelf", "High cut"],
            )
            add(q + "/f", f"Band {b} frequency", "EQ", lo=20, hi=20000, scale="log", unit="Hz")
            add(q + "/g", f"Band {b} gain", "EQ", lo=-15, hi=15, unit="dB")
            add(q + "/q", f"Band {b} Q", "EQ", lo=0.3, hi=10, scale="reverse-log")
    if k in ("input", "bus", "main"):
        toggle(p + "/dyn/on", "Compressor enabled", "Dynamics")
        choice(p + "/dyn/mode", "Mode", "Dynamics", ["Compressor", "Expander"])
        choice(p + "/dyn/det", "Detector", "Dynamics", ["Peak", "RMS"])
        choice(p + "/dyn/env", "Envelope", "Dynamics", ["Linear", "Log"])
        choice(
            p + "/dyn/ratio",
            "Ratio",
            "Dynamics",
            ["1.1", "1.3", "1.5", "2", "2.5", "3", "4", "5", "7", "10", "20", "100"],
        )
        for suffix, label, lo, hi, scale, unit in [
            ("thr", "Threshold", -60, 0, "linear", "dB"),
            ("knee", "Knee", 0, 5, "linear", ""),
            ("mgain", "Makeup", 0, 24, "linear", "dB"),
            ("attack", "Attack", 0, 120, "linear", "ms"),
            ("hold", "Hold", 0.02, 2000, "log", "ms"),
            ("release", "Release", 5, 4000, "log", "ms"),
            ("mix", "Parallel mix", 0, 100, "linear", "%"),
        ]:
            add(p + "/dyn/" + suffix, label, "Dynamics", lo=lo, hi=hi, scale=scale, unit=unit)
        toggle(p + "/dyn/auto", "Auto time", "Dynamics")
        toggle(p + "/insert/on", "Insert enabled", "Insert")
        choice(
            p + "/insert/sel",
            "Insert source",
            "Insert",
            ["Off", "FX1 L", "FX1 R", "FX2 L", "FX2 R", "FX3 L", "FX3 R", "FX4 L", "FX4 R"],
        )
    for processor in ["gate", "dyn"] if k == "input" else ["dyn"] if k in ("bus", "main") else []:
        g = "Gate" if processor == "gate" else "Dynamics"
        add(p + f"/{processor}/keysrc", "Key source (0 = self)", g, "int", hi=22)
        toggle(p + f"/{processor}/filter/on", "Key filter enabled", g)
        choice(
            p + f"/{processor}/filter/type",
            "Key filter type",
            g,
            ["Low cut", "Low shelf", "PEQ", "Vintage EQ", "High shelf", "High cut"],
        )
        add(
            p + f"/{processor}/filter/f",
            "Key frequency",
            g,
            lo=20,
            hi=20000,
            scale="log",
            unit="Hz",
        )
    if k in ("input", "aux", "return"):
        for b in range(1, 11):
            q = p + f"/mix/{b:02}"
            add(
                q + "/level",
                f"{'Bus' if b <= 6 else 'FX'} {b if b <= 6 else b - 6} send",
                "Sends",
                lo=-90,
                hi=10,
                unit="dB",
                scale="fader",
            )
            if b <= 6:
                toggle(q + "/grpon", f"Bus {b} group", "Sends")
                choice(
                    q + "/tap",
                    f"Bus {b} tap",
                    "Sends",
                    ["Input", "Pre EQ", "Post EQ", "Pre fader", "Post fader", "Subgroup"],
                )
                if b % 2:
                    add(q + "/pan", f"Bus {b}/{b + 1} pan", "Sends", lo=-100, hi=100)
    if k in ("bus", "main"):
        choice(p + "/eq/mode", "EQ mode", "EQ", ["Parametric", "Graphic", "True EQ"])
        for hz in [
            "20",
            "25",
            "31_5",
            "40",
            "50",
            "63",
            "80",
            "100",
            "125",
            "160",
            "200",
            "250",
            "315",
            "400",
            "500",
            "630",
            "800",
            "1k",
            "1k25",
            "1k6",
            "2k",
            "2k5",
            "3k15",
            "4k",
            "5k",
            "6k3",
            "8k",
            "10k",
            "12k5",
            "16k",
            "20k",
        ]:
            add(
                p + "/geq/" + hz,
                hz.replace("_", ".") + " Hz",
                "Graphic EQ",
                lo=-15,
                hi=15,
                unit="dB",
            )

for i in range(1, 9):
    toggle(f"/config/chlink/{i}", f"Link channels {i * 2 - 1}/{i * 2}", "Links")
for i in range(1, 4):
    toggle(f"/config/buslink/{i}", f"Link buses {i * 2 - 1}/{i * 2}", "Links")
for i in range(1, 5):
    toggle(f"/config/mute/{i}", f"Mute group {i}", "Mute groups")
for i in range(1, 5):
    add(f"/fx/{i}/type", "Algorithm ID", "Effects", "int", hi=60)
    for j in range(1, 65):
        add(f"/fx/{i}/par/{j:02}", f"Parameter {j} (normalized; algorithm dependent)", "Effects")

# Routing source order and tap points from the X AIR OSC parameter table.
SOURCES = (
    [f"Ch {i}" for i in range(1, 17)]
    + ["Aux L", "Aux R"]
    + [f"FX {i} {side}" for i in range(1, 5) for side in ("L", "R")]
    + [f"Bus {i}" for i in range(1, 7)]
    + [f"FX send {i}" for i in range(1, 5)]
    + ["Main L", "Main R", "Monitor L", "Monitor R"]
)
TAPS = [
    "Analog",
    "Analog + mute",
    "Input",
    "Input + mute",
    "Pre EQ",
    "Pre EQ + mute",
    "Post EQ",
    "Post EQ + mute",
    "Pre fader",
    "Pre fader + mute",
    "Post fader",
]
for base, count in [("aux", 6), ("p16", 16), ("usb", 18)]:
    for i in range(1, count + 1):
        choice(
            f"/routing/{base}/{i:02}/src", f"{base.upper()} output {i} source", "Routing", SOURCES
        )
        choice(f"/routing/{base}/{i:02}/pos", f"{base.upper()} output {i} tap", "Routing", TAPS)
for i in range(1, 3):
    choice(
        f"/routing/main/{i:02}/src", f"Main output {i} source", "Routing", ["Main LR", "Monitor"]
    )
for i in range(1, 9):
    PARAMETERS.pop(f"/config/chlink/{i}")
    toggle(f"/config/chlink/{2 * i - 1}-{2 * i}", f"Link channels {2 * i - 1}/{2 * i}", "Links")
for i in range(1, 4):
    PARAMETERS.pop(f"/config/buslink/{i}")
    toggle(f"/config/buslink/{2 * i - 1}-{2 * i}", f"Link buses {2 * i - 1}/{2 * i}", "Links")
add("/config/solo/level", "Monitor level", "Monitor", lo=-90, hi=10, scale="fader", unit="dB")
choice(
    "/config/solo/source",
    "Monitor source",
    "Monitor",
    ["Off", "LR", "LR + bus", "LR AFL", "Aux", "USB"],
)
toggle("/config/solo/mute", "Monitor mute", "Monitor")
for i in range(1, 17):
    toggle(f"/-stat/solosw/{i:02}", f"Solo channel {i}", "Monitor")
for i in range(1, 5):
    toggle(f"/fx/{i}/bypass", f"FX {i} bypass", "Effects")
# These parameters do not exist on the XR18 stereo aux input.
for leaf in ["config/insrc", "preamp/invert", "preamp/hpon", "preamp/hpf"]:
    PARAMETERS.pop("/rtn/aux/" + leaf, None)
PARAMETERS.pop("/lr/dyn/keysrc", None)
for root in [f"/bus/{i}" for i in range(1, 7)] + ["/lr"]:
    PARAMETERS.pop(root + "/geq/31_5", None)
    add(root + "/geq/31_50", "31.5 Hz", "Graphic EQ", lo=-15, hi=15, unit="dB")

# Enum ordering cross-checked with X AIR scene protocol tables (pmaillot/X32-Behringer).
FX_ALGORITHMS = [
    "HALL",
    "AMBI",
    "RPLT",
    "ROOM",
    "CHAM",
    "PLAT",
    "VREV",
    "VRM",
    "GATE",
    "RVRS",
    "DLY",
    "3TAP",
    "4TAP",
    "CRS",
    "FLNG",
    "PHAS",
    "DIMC",
    "FILT",
    "ROTA",
    "PAN",
    "SUB",
    "D/RV",
    "CR/R",
    "FL/R",
    "D/CR",
    "D/FL",
    "MODD",
    "GEQ2",
    "GEQ",
    "TEQ2",
    "TEQ",
    "DES2",
    "DES",
    "P1A",
    "P1A2",
    "PQ5",
    "PQ5S",
    "WAVD",
    "LIM",
    "CMB",
    "CMB2",
    "FAC",
    "FAC1M",
    "FAC2",
    "LEC",
    "LEC2",
    "ULC",
    "ULC2",
    "ENH2",
    "ENH",
    "EXC2",
    "EXC",
    "IMG",
    "EDI",
    "SON",
    "AMP2",
    "AMP",
    "DRV2",
    "DRV",
    "PIT2",
    "PIT",
]
ROUTING_SOURCES = [
    "Ch01",
    "Ch02",
    "Ch03",
    "Ch04",
    "Ch05",
    "Ch06",
    "Ch07",
    "Ch08",
    "Ch09",
    "Ch10",
    "Ch11",
    "Ch12",
    "Ch13",
    "Ch14",
    "Ch15",
    "Ch16",
    "AuxL",
    "AuxR",
    "Fx1L",
    "Fx1R",
    "Fx2L",
    "Fx2R",
    "Fx3L",
    "Fx3R",
    "Fx4L",
    "Fx4R",
    "Bus1",
    "Bus2",
    "Bus3",
    "Bus4",
    "Bus5",
    "Bus6",
    "Send1",
    "Send2",
    "Send3",
    "Send4",
    "L",
    "R",
    "U01",
    "U02",
    "U03",
    "U04",
    "U05",
    "U06",
    "U07",
    "U08",
    "U09",
    "U10",
    "U11",
    "U12",
    "U13",
    "U14",
    "U15",
    "U16",
    "U17",
    "U18",
]
USB_SOURCES = [
    "Ch01",
    "Ch02",
    "Ch03",
    "Ch04",
    "Ch05",
    "Ch06",
    "Ch07",
    "Ch08",
    "Ch09",
    "Ch10",
    "Ch11",
    "Ch12",
    "Ch13",
    "Ch14",
    "Ch15",
    "Ch16",
    "AuxL",
    "AuxR",
    "Fx1L",
    "Fx1R",
    "Fx2L",
    "Fx2R",
    "Fx3L",
    "Fx3R",
    "Fx4L",
    "Fx4R",
    "Bus1",
    "Bus2",
    "Bus3",
    "Bus4",
    "Bus5",
    "Bus6",
    "Send1",
    "Send2",
    "Send3",
    "Send4",
    "L",
    "R",
]
MONITOR_SOURCES = [
    "OFF",
    "LR",
    "LRPFL",
    "LRAFL",
    "AUX",
    "U1718",
    "Bus1",
    "Bus2",
    "Bus3",
    "Bus4",
    "Bus5",
    "Bus6",
    "Bus12",
    "Bus34",
    "Bus56",
]
FILTER_TYPES = ["LC6", "LC12", "HC6", "HC12", "1.0", "2.0", "3.0", "5.0", "10.0"]

for path, spec in list(PARAMETERS.items()):
    if path.endswith("/gate/mode"):
        choice(path, spec["label"], spec["group"], ["Gate", "Exp 2", "Exp 3", "Exp 4", "Duck"])
    if "/filter/type" in path:
        choice(path, spec["label"], spec["group"], FILTER_TYPES)
    if path.startswith("/routing/") and path.endswith("/src"):
        options = (
            ["Main LR", "Monitor"] + [f"USB {i}/{i + 1}" for i in range(1, 18, 2)]
            if "/main/" in path
            else USB_SOURCES
            if "/usb/" in path
            else ROUTING_SOURCES
        )
        choice(path, spec["label"], spec["group"], options)
    if path.endswith("/config/insrc"):
        choice(path, "Analog source", "Input", [f"Input {i}" for i in range(1, 17)] + ["Off"])
    if path.endswith("/config/rtnsrc"):
        choice(
            path,
            "USB return source",
            "Input",
            [f"USB {i}/{i + 1}" for i in range(1, 18, 2)]
            if path.startswith("/rtn/")
            else [f"USB {i}" for i in range(1, 19)],
        )
    if path == "/lr/insert/sel":
        choice(path, spec["label"], spec["group"], ["Off", "FX 1", "FX 2", "FX 3", "FX 4"])
choice("/config/solo/source", "Monitor source", "Monitor", MONITOR_SOURCES)
for i in range(1, 5):
    choice(f"/fx/{i}/type", f"FX {i} algorithm", "Effects", FX_ALGORITHMS)
for root in [f"/bus/{i}" for i in range(1, 7)] + ["/lr"]:
    PARAMETERS.pop(root + "/geq/31_50", None)
    add(root + "/geq/31.5", "31.5 Hz", "Graphic EQ", lo=-15, hi=15, unit="dB")
for i in range(1, 5):
    PARAMETERS.pop(f"/fx/{i}/bypass", None)
    toggle(f"/fx/{i}/insert", f"FX {i} insert mode", "Effects")
    add(f"/rtn/{i}/preamp/rtntrim", "USB trim", "Input", lo=-18, hi=18, unit="dB")
    toggle(f"/rtn/{i}/preamp/rtnsw", "Use USB return", "Input")
    choice(
        f"/rtn/{i}/config/rtnsrc",
        "USB return source",
        "Input",
        [f"USB {j}/{j + 1}" for j in range(1, 18, 2)],
    )
for key, label in [
    ("preamp", "Preamp"),
    ("eq", "EQ"),
    ("dyn", "Dynamics"),
    ("fdrmute", "Fader and mute"),
]:
    toggle("/config/linkcfg/" + key, "Link " + label, "Links")
for key, label in [("sourcetrim", "Monitor source trim"), ("dimatt", "Dim attenuation")]:
    add(
        "/config/solo/" + key,
        label,
        "Monitor",
        lo=-18 if key == "sourcetrim" else -40,
        hi=18 if key == "sourcetrim" else 0,
        unit="dB",
    )
for key, label in [("dim", "Dim"), ("mono", "Mono"), ("dimplf", "Dim on PFL")]:
    toggle("/config/solo/" + key, label, "Monitor")
for key, label in [("chmode", "Channel solo mode"), ("busmode", "Bus solo mode")]:
    choice("/config/solo/" + key, label, "Monitor", ["PFL", "AFL"])
for g in ["X", "Y"]:
    toggle("/config/amixenable/" + g, "Automix " + g + " enabled", "Monitor")
    toggle("/config/amixlock/" + g, "Automix " + g + " lock", "Monitor")

for strip in STRIPS:
    choice(
        strip["id"] + "/config/color",
        "Color",
        "Setup",
        [
            "Black",
            "Red",
            "Green",
            "Yellow",
            "Blue",
            "Magenta",
            "Cyan",
            "White",
            "Black inverted",
            "Red inverted",
            "Green inverted",
            "Yellow inverted",
            "Blue inverted",
            "Magenta inverted",
            "Cyan inverted",
            "White inverted",
        ],
    )
for i in range(1, 17):
    add(f"/ch/{i:02}/config/icon", "Channel icon ID", "Setup", "int", hi=74)

PARAMETERS['/routing/main/01/src']['label'] = 'Main LR output source'
PARAMETERS['/routing/main/02/src']['label'] = 'Headphones output source'
