"""Regenerate the Maqueen layout: six functional zones, nothing else changed.

The layout was flat -- 21 widgets, no groups, no separators -- so related
controls sat wherever they landed: Mode was diagonally opposite the line
sensors it drives, and the distance graph was in a different part of the
canvas from the distance gauge. Grouped by USE rather than by widget type,
the same rule the Keyes layout follows.

This reads the existing CFG out of maqueen-remote.ts and MOVES widgets. It
does not rebuild them: every widget keeps its own properties untouched --
select `options`, slider ranges, gauge `source`/`units`, led `colorOn`. Only
x/y change, and sizes carry over as-is so no touch target shrinks.

Group boxes are derived from their members, so padding and header clearance
cannot be wrong by hand, and the checks at the bottom fail the run rather than
emitting a layout with overlapping zones or a dropped widget.
"""
import json, base64, itertools, os, re, textwrap

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = f"{HERE}/maqueen-remote.ts"
PAD, TITLE = 24, 34          # side padding, and clearance for the header chip

src = open(SRC, encoding="utf-8").read()
# CFG_EXPERT, not CFG: since levels arrived there are five blobs and `CFG` is
# a `let` that merely points at one of them. Expert is the full panel, which is
# what this file reads back to preserve every widget's own properties.
_m = re.search(r'const CFG_EXPERT = "([^"]*)"', src)
if not _m:
    raise SystemExit("  FAILED - no `const CFG_EXPERT` in maqueen-remote.ts")
OLD_B64 = _m.group(1)
old = json.loads(base64.b64decode(OLD_B64).decode())
# Structural widgets are regenerated from scratch every run, so they are not
# part of the "preserve everything" contract -- otherwise re-running this over
# its own output would report the groups it just built as dropped widgets.
CONTROLS = [w for w in old["widgets"] if w["t"] not in ("group", "separator")]
ORIG = {w["id"]: dict(w) for w in CONTROLS}
W = {w["id"]: dict(w) for w in CONTROLS}


def at(wid, x, y):
    """Move one existing widget. Everything except x/y is left alone."""
    w = W[wid]
    w["x"], w["y"] = x, y
    return w


# Widgets declared with new() are OWNED by this file: their full definition
# lives here, so changing one (say, flipping a spin direction) is the point, not
# a regression. Widgets touched only with at() are the opposite -- the previous
# CFG is their source of truth and nothing but x/y may differ.
OWNED = set()


def new(wid, t, x, y, w, h, **kw):
    """A widget whose definition lives in this file rather than the old CFG."""
    d = dict(id=wid, t=t, x=x, y=y, w=w, h=h)
    d.update(kw)
    W[wid] = d
    OWNED.add(wid)
    return d


def group(gid, label, color, members):
    x1 = min(m["x"] for m in members); y1 = min(m["y"] for m in members)
    x2 = max(m["x"] + m["w"] for m in members); y2 = max(m["y"] + m["h"] for m in members)
    # No model: applyWidgetDefaults already fills in "panel" for a group, and at
    # 35 ms per 18-char chunk the six redundant copies cost ~0.3s of connect time.
    return dict(id=gid, t="group", label=label, color=color,
                x=x1 - PAD, y=y1 - PAD - TITLE,
                w=(x2 + PAD) - (x1 - PAD), h=(y2 + PAD) - (y1 - PAD - TITLE),
                children=[m["id"] for m in members])


# ── DRIVE ───────────────────────────────────────────────────────────────────
# The pad leads. Speed and its readout sit beside it, with STOP above them so
# it is reachable without a thumb crossing the pad.
drive = [
    at("dpad_move",  80, 100),
    at("spd",       560, 100),
    at("btn_stop",  740, 100),
    at("gauge_spd", 740, 250),
    # Per-wheel jog buttons, directly under the pad. Held, not clicked: the app
    # sends "SET <id> 1" on press and "SET <id> 0" on release, so each is a
    # dead-man switch. Holding both at once runs both wheels -> straight ahead.
    # icon/spin/color, not the defaults: without an explicit icon the app hashes
    # the widget id and these landed on a sparkle and a rocket, which say nothing
    # about a wheel. A gear that visibly turns while the button is held does.
    # The cyan matches the DRIVE zone and the pad, so the pair reads as part of
    # the same control rather than two stray buttons.
    # spin -1 on the left, +1 on the right: the two gears turn opposite ways, the
    # way the wheels on either side of the robot do. Both still drive forward.
    new("btn_ml", "button",  80, 580, 200, 120, label="Left motor",
        icon="⚙️", spin=-1, color="#0e7490"),
    new("btn_mr", "button", 300, 580, 200, 120, label="Right motor",
        icon="⚙️", spin=1, color="#0e7490"),
]

# ── HEAD ────────────────────────────────────────────────────────────────────
# Each servo slider paired with its own angle gauge. Before, the two sliders
# were together and the two gauges were together, so neither pairing showed --
# even though gauge_srv1 mirrors slider_srv1 through `source`.
head = [
    at("slider_srv1",  80, 820),
    at("gauge_srv1",  200, 820),
    at("slider_srv2", 400, 820),
    at("gauge_srv2",  520, 820),
]

# ── LIGHTS & SOUND ──────────────────────────────────────────────────────────
# Two rows, not one: a single row of three reached x=1142 and collided with the
# DISTANCE column. The left column has to stay clear of the x=1010 gutter.
lights = [
    at("toggle_led_l", 760, 820),
    at("toggle_led_r", 877, 820),
    at("btn_buzz",     760, 965),
]

# ── DISTANCE ────────────────────────────────────────────────────────────────
# Gauge, alert, read selector and graph together. The selector used to sit
# under the gauge while the graph lived elsewhere on the canvas.
dist = [
    at("gauge_dist", 1060, 100),
    at("alert",      1350, 100),
    at("dist_read",  1060, 320),
    at("graph_dist", 1060, 400),
]

# ── AUTONOMY ────────────────────────────────────────────────────────────────
# Mode belongs beside the line sensors it drives.
auto = [
    at("ln_l", 1060, 810),
    at("ln_r", 1156, 810),
    at("mode", 1254, 820),
]

# ── SCREEN ──────────────────────────────────────────────────────────────────
# The OLED's controls, mirroring the rover's. Placed in the LEFT column under
# LIGHTS & SOUND rather than beside SYSTEM: the right column is already three
# zones deep, and the typed-message field wants width that only this side has.
#
# screen_mode's options are the firmware's SCREEN_* constants in order, and the
# firmware pushes the value back whenever button A changes it on the robot, so
# the selector and the button can never disagree.
screen = [
    new("screen_mode", "select", 80, 1180, 200, 92, label="Screen",
        options="Status,Face,Auto,Radar"),
    new("oled_text", "editfield", 320, 1180, 320, 92, label="Message"),
    new("lbl_oled", "label", 680, 1180, 240, 92, label="On screen"),
    # Five looks, one mood system: the face still blinks, worries and is
    # startled in every one of them. Second row so the zone stays clear of the
    # x=1012 gutter rather than reaching across it.
    new("face_style", "select", 80, 1300, 200, 92, label="Face style",
        options="Round,Circle,Robot,Big,Visor"),
    # How the radar's head behaves: panning on its own, or aimed by hand with
    # the Servo 1 slider. Sweep is the default because a scope that does not
    # move is just a distance gauge drawn the long way round.
    new("head_mode", "select", 320, 1300, 200, 92, label="Radar head",
        options="Sweep,Aim"),
]

# ── SYSTEM ──────────────────────────────────────────────────────────────────
system = [
    at("lbl_ver",       1060, 1020),
    at("lbl_heartbeat", 1190, 1020),
    at("upd",           1060, 1120),
    # Which panel the robot serves. It has to live in SYSTEM because it has to
    # live in EVERY level -- see gen_levels.py. A Level selector that appeared
    # only in Expert would strand the robot in whatever panel you picked.
    new("level", "select", 1250, 1120, 180, 94, label="Level",
        options="Beginner,Expert,Drive,Distance,Screen"),
]

ZONES = [
    ("grp_drive", "DRIVE",          "#00d4ff", drive),
    ("grp_head",  "HEAD",           "#ff9500", head),
    ("grp_light", "LIGHTS & SOUND", "#c084fc", lights),
    ("grp_dist",  "DISTANCE",       "#ffb020", dist),
    ("grp_auto",  "AUTONOMY",       "#00e676", auto),
    ("grp_scr",   "SCREEN",         "#38bdf8", screen),
    ("grp_sys",   "SYSTEM",         "#8892b0", system),
]

groups, controls = [], []
for gid, label, color, members in ZONES:
    groups.append(group(gid, label, color, members))
    controls += members

# Separators sit in the gutters the groups already leave, so they mark the
# divisions without belonging to any zone. The checks below prove they touch
# nothing.
seps = [
    dict(id="sep_cols", t="separator", x=1012, y=100, w=8,   h=680),   # column split
    dict(id="sep_left", t="separator", x=80,   y=745, w=890, h=8),     # drive / rest
    dict(id="sep_rt1",  t="separator", x=1060, y=730, w=490, h=8),     # distance / autonomy
    dict(id="sep_rt2",  t="separator", x=1060, y=946, w=490, h=8),     # autonomy / system
]

# Groups first: they are backdrops, and the renderer paints in array order.
widgets = groups + seps + controls
cfg = {"title": old.get("title", "Maqueen Remote"), "widgets": widgets,
       "canvas": {"w": max(w["x"] + w["w"] for w in widgets) + 56,
                  "h": max(w["y"] + w["h"] for w in widgets) + 56}}

# ── checks ──────────────────────────────────────────────────────────────────
box = lambda w: (w["x"], w["y"], w["x"] + w["w"], w["y"] + w["h"])
def ov(a, b):
    a1, b1, a2, b2 = box(a); c1, d1, c2, d2 = box(b)
    return not (a2 <= c1 or c2 <= a1 or b2 <= d1 or d2 <= b1)

errs = []
missing = set(ORIG) - {w["id"] for w in controls}
if missing:
    errs.append(f"widgets dropped from the layout: {sorted(missing)}")
# Only x and y may differ from the original. Guards against a rewrite quietly
# losing a select's `options` or a gauge's `source`.
for w in controls:
    if w["id"] in OWNED or w["id"] not in ORIG:
        continue                      # declared above; this file is its source of truth
    lost = [k for k, v in ORIG[w["id"]].items() if k not in ("x", "y") and w.get(k) != v]
    if lost:
        errs.append(f"{w['id']} lost/changed {lost}")
by = {w["id"]: w for w in widgets}
for g in groups:
    gx1, gy1, gx2, gy2 = box(g)
    for cid in g["children"]:
        x1, y1, x2, y2 = box(by[cid])
        if min(x1 - gx1, gx2 - x2, gy2 - y2) < PAD:
            errs.append(f"{cid} padding < {PAD} in {g['label']}")
        if y1 - gy1 < PAD + TITLE:
            errs.append(f"{cid} sits under the {g['label']} header")
for a, b in itertools.combinations(groups, 2):
    if ov(a, b): errs.append(f"group overlap {a['label']} ~ {b['label']}")
for a, b in itertools.combinations(controls, 2):
    if ov(a, b): errs.append(f"control overlap {a['id']} ~ {b['id']}")
for s in seps:
    for o in groups + controls:
        if ov(s, o): errs.append(f"separator {s['id']} overlaps {o['id']}")

print(f"  zones={len(groups)} separators={len(seps)} controls={len(controls)} total={len(widgets)}")
print(f"  canvas {cfg['canvas']['w']}x{cfg['canvas']['h']}")
for g in groups:
    print(f"    {g['label']:15} {g['w']:4}x{g['h']:<4} @ {g['x']:5},{g['y']:<5} {len(g['children'])} items")
print()
if errs:
    print("  FAILED"); [print("   -", e) for e in errs]; raise SystemExit(1)
kept = sorted(set(ORIG) - OWNED)
print(f"  PASS - geometry valid; {len(kept)} carried-over widgets untouched, "
      f"{len(OWNED)} declared here: {sorted(OWNED)}")

# Compact the wire form. `groupId` on each member and `children` on each group
# are two spellings of the same fact, and every app that understands groups
# (maqueen v2.14, keystudio/rxy_web v2.16) back-fills groupId from the children
# lists during reconcile. bit-rxy v1.5 predates structural widgets and ignores
# both. So groupId is never emitted and children goes out as the comma string
# those apps already accept. This matters here: unlike the ESP32 firmware, this
# micro:bit sends CFG in fixed 18-char chunks, so every 18 bytes of layout is
# another ~20ms of connect time.
for w in cfg["widgets"]:
    w.pop("groupId", None)
    if w["t"] == "group":
        w["children"] = ",".join(w["children"])

mini = json.dumps(cfg, separators=(",", ":"), ensure_ascii=False)
b64 = base64.b64encode(mini.encode()).decode()
n, on = -(-len(b64) // 18), -(-len(OLD_B64) // 18)
print(f"  base64 {len(OLD_B64)} -> {len(b64)} B   chunks {on} -> {n}   "
      f"load ~{on*0.035:.1f}s -> ~{n*0.035:.1f}s")
# encoding pinned on both handles: the jog buttons carry an emoji icon, and
# Python on Windows defaults these to cp1252, which cannot encode it. The run
# then dies AFTER printing a green PASS, which reads as success right up until
# the missing file is noticed.
json.dump(cfg, open(f"{HERE}/layout_maqueen.json", "w", encoding="utf-8"),
          indent=1, ensure_ascii=False)
open(f"{HERE}/layout_b64.txt", "w", encoding="utf-8", newline="\n").write("\n".join(textwrap.wrap(b64, 100)) + "\n")
print("  wrote layout_maqueen.json + layout_b64.txt")
