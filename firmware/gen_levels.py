"""Build the five panels the Level selector switches between.

gen_layout.py designs ONE layout -- the full Expert panel, zone by zone, with
its own geometry checks. This takes that finished layout and cuts subsets from
it, so the panels cannot drift apart: a widget moved in gen_layout.py moves in
every level that carries it, and no level can contain a widget that does not
exist in the real one.

WHY LEVELS AT ALL. The full panel is 332 chunks, and this micro:bit sends CFG
in fixed 18-character chunks about 35ms apart -- roughly 11.6 seconds before a
child sees anything. Beginner is a tenth of that. Loading a graph, a radar
head control and fourteen system widgets to teach someone which button goes
forward is time spent for nothing.

REPACKING, not just filtering. A subset that kept its absolute coordinates
would inherit the holes where the omitted widgets used to be: Beginner would
be four controls scattered across a 1621x1472 canvas with nothing in between.
So the surviving ZONES are repacked -- each group keeps its own internal
arrangement, which is the part gen_layout.py reasoned about, and only the
groups themselves are re-flowed into a compact canvas.
"""
import json, base64, os, re, textwrap

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = f"{HERE}/maqueen-remote.ts"
FULL = json.load(open(f"{HERE}/layout_maqueen.json", encoding="utf-8"))
PAD, TITLE, GAP = 24, 34, 32

widgets = FULL["widgets"]
BY = {w["id"]: w for w in widgets}
GROUPS = [w for w in widgets if w["t"] == "group"]
CONTROLS = [w for w in widgets if w["t"] not in ("group", "separator")]

# `level` MUST appear in every panel. If it existed only in Expert, choosing
# Beginner would strand the robot there until it was reflashed -- the rover
# carries the same warning for the same reason.
# These mirror the rover's IDS_* lists widget for widget wherever the hardware
# allows. Two rover widgets have no Maqueen counterpart -- trim (its wheels are
# servos and need calibrating; these are geared motors) and beeps -- and two
# Maqueen widgets have no rover counterpart: the line sensors and the drive
# Mode they feed. Those follow the rover's rule for its own extras rather than
# being sprinkled about: Expert only.
#
LEVELS = {
    "BEGINNER": "dpad_move btn_stop gauge_dist alert lbl_ver level",
    "DRIVE":    "dpad_move spd btn_stop gauge_spd btn_ml btn_mr level",
    # The head lives here because it AIMS THE SONAR. Putting it beside the
    # screen controls, as an earlier cut did, split the radar in half: the
    # thing that points the sensor sat on one panel and the reading it
    # produces on another. The rover files srv_head/gauge_head/head_mode under
    # Distance for exactly this reason.
    "DIST":     "gauge_dist alert dist_read graph_dist "
                "slider_srv1 gauge_srv1 head_mode level",
    # btn_buzz rides along here as it does on the rover: it is the other thing
    # the robot does at you rather than with, and it has nowhere better.
    "SCREEN":   "screen_mode oled_text lbl_oled face_style btn_buzz level",
    "EXPERT":   None,                      # None means "everything"
}
# Expert is the full panel including its separators; the subsets drop those,
# since a separator's whole job is to mark a division between zones that a
# subset may not even contain.
MAX_W = 1621


def build(ids):
    """Filter to `ids`, rebuild each zone from its survivors, repack, encode."""
    keep = None if ids is None else set(ids.split())
    zones = []
    for g in GROUPS:
        children = [c for c in str(g["children"]).split(",") if c]
        members = [BY[c] for c in children if keep is None or c in keep]
        if members:
            zones.append((g, members))
    loose = [w for w in CONTROLS
             if (keep is None or w["id"] in keep)
             and not any(w in m for _, m in zones)]

    out, x, y, rowH = [], PAD, PAD, 0
    for g, members in zones:
        x1 = min(m["x"] for m in members)
        y1 = min(m["y"] for m in members) - TITLE
        x2 = max(m["x"] + m["w"] for m in members)
        y2 = max(m["y"] + m["h"] for m in members)
        gw, gh = (x2 - x1) + PAD * 2, (y2 - y1) + PAD * 2
        if x > PAD and x + gw > MAX_W:                 # wrap to the next row
            x, y, rowH = PAD, y + rowH + GAP, 0
        dx, dy = x - (x1 - PAD), y - (y1 - PAD)
        box = dict(g)
        box["x"], box["y"], box["w"], box["h"] = x, y, gw, gh
        box["children"] = ",".join(m["id"] for m in members)
        out.append(box)
        for m in members:
            c = dict(m)
            c["x"], c["y"] = m["x"] + dx, m["y"] + dy
            out.append(c)
        x += gw + GAP
        rowH = max(rowH, gh)

    # Anything not inside a zone rides along underneath, in a plain row.
    lx, ly = PAD, y + rowH + GAP
    for w in loose:
        c = dict(w)
        c["x"], c["y"] = lx, ly
        out.append(c)
        lx += w["w"] + GAP

    if ids is None:                                    # Expert keeps the original
        out = [dict(w) for w in widgets]

    cfg = {"title": FULL.get("title", "Maqueen Remote"), "widgets": out,
           "canvas": {"w": max(w["x"] + w["w"] for w in out) + 56,
                      "h": max(w["y"] + w["h"] for w in out) + 56}}
    mini = json.dumps(cfg, separators=(",", ":"), ensure_ascii=False)
    return base64.b64encode(mini.encode()).decode(), cfg


# `level` is a real widget and has to exist in the full layout before it can be
# cut into a subset. gen_layout.py owns it; fail loudly rather than emitting
# panels with no way back out of them.
if "level" not in BY:
    raise SystemExit("  FAILED - no `level` widget in layout_maqueen.json; "
                     "add it to gen_layout.py first")

blobs, ids_lists = {}, {}
for name, ids in LEVELS.items():
    b64, cfg = build(ids)
    blobs[name] = b64
    got = [w["id"] for w in cfg["widgets"] if w["t"] not in ("group", "separator")]
    ids_lists[name] = got
    if "level" not in got:
        raise SystemExit(f"  FAILED - {name} has no `level` widget; it would strand the robot")
    if ids is not None:
        missing = set(ids.split()) - set(got)
        if missing:
            raise SystemExit(f"  FAILED - {name} asks for widgets the layout does not have: {sorted(missing)}")
    print(f"  {name:9} {len(got):2} widgets  {len(b64):5} B  "
          f"{-(-len(b64)//18):3} chunks  ~{-(-len(b64)//18)*0.035:5.1f}s  "
          f"canvas {cfg['canvas']['w']}x{cfg['canvas']['h']}")

src = open(SRC, encoding="utf-8").read()
for name, b64 in blobs.items():
    pat = re.compile(r'const CFG_%s = "[^"]*"' % name)
    if not pat.search(src):
        raise SystemExit(f"  FAILED - no `const CFG_{name} = \"...\"` in {SRC}")
    src = pat.sub('const CFG_%s = "%s"' % (name, b64), src, count=1)
for name, got in ids_lists.items():
    pat = re.compile(r'const IDS_%s = "[^"]*"' % name)
    if not pat.search(src):
        raise SystemExit(f"  FAILED - no `const IDS_{name} = \"...\"` in {SRC}")
    src = pat.sub('const IDS_%s = ",%s,"' % (name, ",".join(got)), src, count=1)
open(SRC, "w", encoding="utf-8", newline="\n").write(src)
print("  spliced all five panels into maqueen-remote.ts")
