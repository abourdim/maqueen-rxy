# Maqueen RXY

A Bluetooth remote for the **DFRobot Maqueen Lite**, driven from a micro:bit.
Nothing to install, no account, no WiFi.

**The robot owns the layout.** The web app is a renderer: it connects, asks the
robot for its configuration, and draws whatever comes back. There is nothing to
set up on the browser side and no per-robot build of the app — the same page
serves every rxy robot.

## What you need

- BBC micro:bit — **V2 recommended**: the logo-touch face works only there
- DFRobot **Maqueen Lite** chassis
- *Optional:* an **SSD1306 128×64 OLED** on the I2C header at `0x3C`
- Chrome or Edge, on desktop or Android. Safari and iOS cannot do this at all —
  every iOS browser is WebKit underneath and none implement Web Bluetooth

## Flashing

Two MakeCode extensions are required, and it will not compile without both:

- `pxt-maqueen` — search "maqueen" in the Extensions dialog
- `https://github.com/tinkertanker/pxt-oled-ssd1306` — paste the URL

Then paste [`firmware/maqueen-remote.ts`](firmware/maqueen-remote.ts) into
[makecode.microbit.org](https://makecode.microbit.org) in JavaScript mode and
download. The version scrolls across the LED matrix at boot, so you can check
what is actually flashed before debugging anything else.

## Level — pick a panel

The layout goes out in fixed 18-character chunks about 35ms apart, so the full
panel takes nearly twelve seconds to arrive. Loading a graph, a radar control
and fourteen system widgets to teach someone which button goes forward is time
spent for nothing, so the **Level** selector chooses what the robot serves:

| Level | widgets | load | carries |
|---|---|---|---|
| Beginner | 6 | ~2.7s | drive pad, stop, distance, alert |
| Drive | 7 | ~3.0s | pad, speed, per-wheel jog |
| Distance | 8 | ~4.1s | gauge, graph, one-shot read, **and the radar head** |
| Screen | 6 | ~2.8s | screen mode, message, face style, buzz |
| Expert | 29 | ~11.9s | everything |

The split mirrors the rover's own `IDS_*` lists widget for widget wherever the
hardware allows. The head sits under **Distance** because it aims the sonar —
filing it with the screen controls would split the radar in half, with the
thing that points the sensor on one panel and the reading it produces on
another. Line sensors and drive Mode have no rover counterpart, so they follow
the rover's rule for its own extras: Expert only.

Switching pushes the new panel immediately — no reconnect. Telemetry is filtered
to match, so nothing is published to a widget the panel does not contain.

## The screen

With an OLED fitted, **button A** cycles four modes and the app's *Screen*
selector chooses the same four:

- **Status** — link and uptime, drive mode, speed, last motor command, distance
  and both line sensors. Disconnected, it shows the **pairing name** instead of
  the drive mode: the browser lists every board as `BBC micro:bit [xxxxx]` and
  picking your own out of a classroom is otherwise a guess.
- **Face** — two eyes with moods, below.
- **Auto** — Status until the app connects, then Face.
- **Radar** — a sonar map. It only means anything **with the ultrasonic mounted
  on Servo 1**; left on the chassis every reading lands at the same heading and
  the scope draws one spoke, which is all the robot can see. *Radar head*
  chooses Sweep (pans itself) or Aim (follows the Servo 1 slider).

At power-up the screen runs a **self-test** before anything else: the screen and
motor driver addresses, a real sonar reading, and both line sensors as raw pin
values. Every line is a measurement taken just then — a test that cannot fail
tells you nothing.

### The face

Moods, in the order they outrank each other: **happy** (logo touched, V2),
**alarm** (picked up or tipped), **startle** (something just arrived in front),
**dizzy** (just spun on the spot), **worried** (something close ahead),
**asleep** (20s with no command *and* nothing moving it — a nudge wakes it as well as a command does), and otherwise **open** — blinking, where one blink in
four is a wink. Driving, the pupils follow the D-pad; parked, they follow
whichever line sensor is over the line.

Five styles — Round, Circle, Robot, Big, Visor — from **button B** or the app's
*Face style* selector. A style is a look, not a behaviour: all five blink,
worry, startle and sleep.

## Reading the robot without a screen

Every command leaves a mark on the micro:bit's LED matrix, so an unscreened
robot can still be read across a table: `vNN` scrolling is the version at boot,
a hollow ring means powered and waiting, a filling grid is the layout going out,
✓ connected, ✗ link lost with motors stopped, ■ STOP, arrows for direction, a
centre dot for idle, side bands for the headlights, ♪ for buzz, and a bar graph
for a servo angle. The D-pad is the one deliberate exception — visual feedback
was removed from its hot path because responsiveness matters more.

## Protocol

Plain text lines over the Nordic UART service.

```
app   -> robot   GETCFGVER                 what is your layout's fingerprint?
robot -> app     CFGVER <revision>
app   -> robot   CFGOK <revision>          already cached, send nothing
app   -> robot   GETCFG                    send the whole thing
robot -> app     CFGBEGIN <chunkCount> / CFG <b64> / CFGEND
app   -> robot   SET <widgetId> <value...>
robot -> app     UPD <widgetId> <value>
app   -> robot   'a'..'p'                  complete D-pad state, one byte
```

**Keep messages at or under 20 bytes.** The micro:bit negotiates the default
23-byte ATT MTU, leaving exactly 20 bytes of payload, and a longer write is
*silently truncated* rather than rejected — the trailing newline never arrives
and the command vanishes with no error at either end. This is why the D-pad
sends a single byte: `SET dpad_move up 1` fits at 19 bytes while `down`, `left`
and `right` do not, which is why only "up" ever worked before v43.

## Repository

| Path | What |
|---|---|
| `firmware/maqueen-remote.ts` | the firmware — paste this into MakeCode |
| `firmware/gen_layout.py` | designs the full Expert layout, zone by zone |
| `firmware/gen_levels.py` | cuts the five Level panels out of it |
| `index.html` `script.js` `styles.css` | the web app |

Licence: MIT. Powered by [Workshop-DIY.org](https://workshop-diy.org).

---

Everything below is the version history, newest first.

# Firmware v65 — the pictures wait for a link

Face, Auto and Radar now all wait for a connection, and Status holds the glass
until then. This is the rover's rule and it was wrong here from v58 to v64:
Face was allowed while disconnected, so choosing it hid the very thing the
status screen exists to show.

The reasoning is the rover's own. Before a link exists the only question worth
answering is *which* micro:bit this is — the browser's chooser lists them all
alike, so a robot showing eyes or a sweeping scope is withholding the one fact
you need to pick it out of a classroom. v61 added the pairing name to the
status screen precisely to answer that, and then let Face cover it up.

Found by diffing this firmware's `faceWanted()` against the rover's rather than
by anything going wrong, so it is worth saying plainly what is still
*deliberately* different from the rover — all of it additive:

- **startle** is a mood the rover does not have
- **five face styles**; the rover has one
- **a third range ring** at 10 cm, and a true semicircle rather than a scope
  stretched sideways by two — both earned by 64 rows against the rover's 32
- the pupils follow the **line sensors** when parked, where the rover's follow
  its sweep head

# Firmware v64 — a nudge wakes it

The face shuts its eyes after twenty seconds, and until now only a drive
command opened them again — so a robot sitting on a shelf with no app connected
could never wake at all. Knocking the table does it now, the way it would for
anything else asleep.

Movement is compared **frame to frame**, not against the resting attitude
measured at boot. The question is whether something moved it, not how it is
being held: measured against rest, a robot carried across a room and set down
at a new angle would read as permanently nudged, and being held is already what
the *alarm* mood answers, one rank higher.

The threshold is 140 milli-g on the vector difference, well clear of the
accelerometer's own noise — the boot calibration has to average four samples to
see past that noise, which is the measure of it. Too low and motor vibration,
or a hand resting on the same table, would keep the robot awake for ever; this
wants a deliberate knock. It compares squares against a square, since a real
distance would mean a square root every frame to answer a yes/no question.

The detector is seeded from the boot calibration rather than left at zero,
which would otherwise read the very first frame as a shove of a full g and wake
the robot at every power-up.

# Firmware v63 — faithful to the rover, and a proper README

The Level split now mirrors the rover's own `IDS_*` lists widget for widget
wherever the hardware allows. Four things had drifted:

- **The radar head moved to Distance.** It aims the sonar, and filing it with
  the screen controls split the radar in half — the thing that points the
  sensor on one panel, the reading it produces on another. The rover files
  `srv_head`/`gauge_head`/`head_mode` under Distance for exactly this reason.
- **Buzz joined Screen**, as it rides along on the rover's `IDS_SCREEN`.
- **Mode left Drive.** The rover keeps it in Expert only; line sensors and the
  drive Mode they feed have no rover counterpart, so they follow the rover's
  rule for its own extras.
- **Level's options and the LAYOUT_\* constants** are ordered as the rover
  orders them, so the two firmwares read side by side without translation.

| Level | widgets | load |
|---|---|---|
| Beginner | 6 | ~2.7s |
| Drive | 7 | ~3.0s |
| Distance | 8 | ~4.1s |
| Screen | 6 | ~2.8s |
| Expert | 29 | ~11.9s |

**A generator broke and said nothing about it.** `gen_layout.py` reads the
previous layout back out of the firmware to preserve every widget's own
properties, and it looked for `const CFG = "..."` — which stopped existing in
v62, when one blob became five and `CFG` turned into a `let` pointing at one of
them. It failed with a bare `AttributeError` on a `None`. It now reads
`CFG_EXPERT` explicitly and fails with a sentence if that is missing too.

**And the README is a README again.** `readme.md` had become a pure changelog:
whoever landed on it first saw "Firmware v62 — Level..." with no idea what the
project was. There is now an overview above the history — what it is, what you
need, both required extensions, the Level table, the screen and its four modes,
the face and its five styles, the LED-matrix legend for an unscreened robot,
and the protocol with the 20-byte rule. `README.html` carries the same content.

# Firmware v62 — Level, so a beginner does not wait twelve seconds

The rover's Level selector, on the Maqueen. Five panels are compiled in and the
robot pushes the new one immediately rather than waiting for a reconnect:

| Level | widgets | load | what it carries |
|---|---|---|---|
| Beginner | 6 | ~2.7s | drive pad, stop, distance, alert |
| Drive | 8 | ~3.6s | the pad, speed, per-wheel jog, mode |
| Distance | 7 | ~3.3s | gauge, graph, one-shot read, line LEDs |
| Screen | 8 | ~3.6s | screen mode, message, face style, radar head |
| Expert | 29 | ~11.9s | everything |

CFG goes out in fixed 18-character chunks about 35ms apart, so the full panel
is nearly twelve seconds before a child sees anything. Loading a graph, a radar
head control and fourteen system widgets to teach someone which button goes
forward is time spent for nothing. **Beginner is a tenth of Expert.**

Telemetry is filtered to the panel on screen as well: publishing a distance
sample to a Beginner panel that has no graph spends 18 characters of a very
slow link on a widget that is not there.

## How the panels are built

`gen_levels.py` cuts the subsets out of the finished layout that `gen_layout.py`
designs, so the two cannot drift: a widget moved in the layout moves in every
level that carries it, and no level can contain a widget that does not exist in
the real one.

Subsets are **repacked, not just filtered**. Keeping absolute coordinates would
inherit the holes where the omitted widgets used to be — Beginner would be four
controls scattered across a 1621x1472 canvas with nothing in between. Each zone
keeps its own internal arrangement, which is the part `gen_layout.py` reasoned
about, and only the zones themselves are re-flowed.

`level` must appear in every panel, and the generator **fails the build** if it
does not. A selector that existed only in Expert would strand the robot in
whatever panel you picked until it was reflashed.

## A bug this turned up

`CFG_REV` was declared *below* the `applyLayout()` bootstrap call. Static
TypeScript rejects the forward reference — but the more interesting half is
what would have happened if it did not: a `let` initialiser sitting below the
call runs second, so it would have reset the revision to `""` immediately after
`applyLayout` computed it, leaving the robot advertising an empty `CFGVER` that
no cache could ever match. Declared above it now, with the reason written down.

# Firmware v61 — the pairing name, five faces, and the radar

**The Status screen names the robot while it is disconnected.** The browser's
chooser lists every board as `BBC micro:bit [xxxxx]` and they all look alike,
so picking your own out of a classroom was a guess. The row that usually
carries the drive mode shows `micro:bit zovip` instead while there is no link
— the mode is meaningless then anyway, since a dropped link resets it to
Manual. The boot self-test shows the same name, at the first moment anyone
would want it.

**Five face styles** — Round, Circle, Robot, Big, Visor — from the app's Face
style selector or button B on the robot. A style is a look, not a behaviour:
all five blink, worry, startle, sleep and wink, so none of the mood logic
knows which is in force. Only three things vary between them: how deeply the
corners are cut, how tall the eye is, and how big the pupil is.

How far the pupils travel is **clamped per style against that style's own
geometry** rather than by one shared constant. A circular eye has under half
the room a hard rectangle does, and Visor — a 24-pixel band — has barely any
vertically. Since the pupil is a hole, one that reaches the border opens the
eye into a C. Clamping against the geometry rather than tuning five constants
by eye also means a sixth style cannot reintroduce that bug. Verified across
every style, mood and gaze extreme: zero border breaks.

**The radar**, ported from the rover, with its Sweep/Aim head control.

> It only means anything **if the ultrasonic is mounted on Servo 1**. Left on
> the chassis, every reading lands at the same heading and the scope draws a
> single spoke — which is exactly right, because that is all the robot can see.

Sweep pans the head on its own; Aim hands it to the Servo 1 slider and plots
wherever you point it. Either way, leaving the radar screen hands the horn back
to where the slider thinks it is, so the two never disagree.

At 64 rows the scope needed **no stretching**. The rover squashes its half-disc
sideways by two because a 32-row panel allows only a 31-pixel radius, leaving
two thirds of the width black. Here the radius reaches 62 and the semicircle is
true. The same extra height earns a third range ring: the rover draws 30 and
100 cm only, since at its size a 10 cm ring lands at 7 pixels and merely
thickens the origin — here it reaches 15 and is worth having. The distance
scale is the rover's, deliberately non-linear, so the first 10 cm takes a
quarter of the radius and the robot's own scope agrees with the app's radar
widget about what "close" looks like.

Blips persist and fade over five seconds, so a sweep builds a picture of the
room rather than flashing one number. Readings at or past max are never
plotted: that value means "no echo", and drawing it would paint a wall at full
range around an empty room.

## Cost

The layout is now 332 chunks, up from 312 — **first connect is about 11.6s**,
roughly 0.7s more than v60. Only the first pays it; the revision cache answers
afterwards. Three new widgets: Face style, Radar head, and Radar joining the
Screen selector.

`DIST_MAX_CM` moved up beside the other distance limits. The radar reads it and
is drawn from the screen section far above the polling loop that used to own
it, and static TypeScript rejects use-before-declaration.

# Firmware v60 — the screen comes up first, and the self-test is real

**Boot was not slow; the screen was simply last in the queue.**
`basic.showString()` ran ahead of `oledInit()`, and it scrolls the version
across the 5x5 matrix a column at a time, blocking for roughly two seconds
while it does. The panel sat dark through all of it, so the robot looked dead
until the self-test finally appeared. The OLED is now brought up before
anything that blocks, and lights within milliseconds of power-on. The LED
scroll still happens, behind the already-readable self-test, and at 80ms per
column instead of the 150ms default since the OLED is carrying the same
version number anyway.

The self-test's hold now starts at the END of boot rather than when it was
drawn. Drawn early on purpose, it would otherwise have spent most of its hold
behind the LED scroll and the accelerometer sampling, then been replaced a
moment after those finished — readable for a fraction of the time it looked
like it was being given.

**The self-test now tests something.** It pinged two I2C addresses before,
which cannot tell you why a robot is not driving. It now reports:

```
Workshop-DIY.org
Maqueen      v60
                        <- blank
Screen 0x3C   ok
Driver 0x10   ok
Sonar    45 cm          clear | NO ECHO
Line     L 1   R 0
```

Every line is a measurement taken just now, not a claim: the driver line means
that address ACKed, the sonar line means a pulse came back. A test that cannot
fail tells you nothing, so nothing here is hardcoded to pass. The line sensors
show RAW pin values rather than the inverted "on the line" sense the app
displays — an unplugged sensor reads a constant, and seeing which constant is
the point of a bring-up screen.

The one sonar reading costs up to ~250ms when nothing echoes back. That is
affordable exactly once, here, which is why the polling loop is careful about
it everywhere else. Hold is 3.5s, up from 2.5s, since there is more to read.

# Firmware v59 — the screen in the app, and eyes that react

**A Screen zone in the panel**, mirroring the rover's: a `Status / Face / Auto`
selector, a Message field that types onto the robot's glass, and a label
reporting what is actually on it. The selector and button A stay in step in
both directions — A pushes its value back, and a fresh connect reports the
mode the robot is really in rather than assuming Status, since A works with no
app attached.

Generated through `firmware/gen_layout.py`, which checks its own geometry: 7
zones, 37 widgets, no overlaps, the 21 carried-over widgets untouched. The
layout grew 281 → 312 chunks, so **first connect costs about 1.1s more**
(~10.9s). Only the first pays it; the revision cache answers after that.

**Eyes that react.** The pupils follow the D-pad while driving, diagonals
included, and setting off after a rest earns one blink — noticing where it is
going, rather than a twitch on every button. A new **startle** mood fires when
something first arrives in front of the robot: eyes wide, pupils small and up,
550ms, outranking dizzy and worried before settling into worried. It fires on
the crossing, not the condition; watching the flag itself would leave the robot
staring wide-eyed for as long as it sat near a wall.

This lifts v58's freeze-while-driving rule, which was inherited from the rover
and does not apply here. The rover's eyes track a head that sweeps
*continuously* — a new frame every tick, forever, on the bus the servos need.
A direction glance changes only when a button does, and an unchanged frame is
already dropped, so holding a direction costs exactly one frame. The 180ms
ration is a floor under a mashed D-pad, not a frame rate.

## Fixes

`gen_layout.py` wrote its JSON through a handle opened with no encoding, so on
Windows cp1252 choked on the jog buttons' emoji icon — *after* printing a green
PASS, which reads as success until the missing file is noticed. Both output
handles are now pinned to UTF-8.

The OLED and face section moved above `handleWidget`. MakeCode's static
TypeScript rejects forward *variable* references even from inside a function
body — this file already records that, which is why `heartbeat` sits where it
does — and the new widget handlers touch `screenMode`, `faceSig`, `oledOnGlass`
and `screenReport`. `screenReport` also went from `sendValue` to `sendUiValue`:
direct feedback to an explicit user action should not be gated by the Telemetry
selector, the same reason the distance one-shot bypasses it.

# Firmware v58 — a 128x64 OLED, ported from dfrobot-rover

The Maqueen has a screen. **Button A** cycles three modes:

- **Status** — link and uptime, drive mode, speed, last motor command,
  distance, and both line sensors. What the LED-matrix glyph legend was
  standing in for all along.
- **Face** — two eyes drawn from a framebuffer, with moods.
- **Auto** — Status until the app connects, then Face.

A boot splash reports whether the screen (0x3C) and the motor driver (0x10)
both ACKed on the I2C bus, so a mis-wire announces itself before anything else
gets debugged.

Requires a second MakeCode extension:
`https://github.com/tinkertanker/pxt-oled-ssd1306`.

## The face

Moods, in the order they outrank each other: **happy** (logo touched, V2),
**alarm** (picked up or tipped — small pupils, eyes down), **dizzy** (just
spun on the spot), **worried** (something close ahead, from the sonar),
**asleep** (20s with no command), and otherwise **open**, blinking, where one
blink in four is a wink.

Awake, the pupils follow whichever line sensor is over the line. The rover's
eyes follow its sweep head; this robot has no head, and the line beneath it is
the one thing it is actually looking at.

Resting attitude is **measured at boot**, never assumed — the micro:bit lies
flat here where the rover's stands upright in its driver board. Hardcode it
and the robot decides it is being held in the air permanently, wears the
alarmed face forever, and hides every other expression behind it.

## Why 128x64

The OLED library hardcodes the row-count registers for a 64-row panel; a
128x32 screen needs `0xA8/0x1F` and `0xDA/0x02` poked in by hand afterwards,
which is the workaround `dfrobot-rover` carries. At 64 rows there is nothing
to correct. The eyes are scaled up to suit: doubling the height alone leaves
two tall slots, so they grow sideways too.

## The bus is the constraint, not the screen

The motor driver is itself on I2C, and unthrottled writes are already known to
lock that bus hard enough to freeze the runtime. Text is ~10 I2C transactions
per character — ~1700 for a full panel — while a face frame is 16 writes of 65
bytes, which is why the face has its own framebuffer instead of the library's
drawing calls.

Neither renderer ever runs from the BLE receive path, neither runs while the
wheels are turning, and neither redraws when nothing changed. That last rule
constrains content: uptime is shown in **minutes** and distance is quantised
to **5 cm**, because anything that ticks on its own would repaint the whole
panel at its own rate forever. The 120ms tick is a *look*, not a draw — but it
has to be that brisk, since a blink is only 140ms shut.

A missing panel is detected once at boot and disables the screen entirely,
rather than spending transactions writing into the void on every refresh.

## Not ported

**No radar.** A sonar map needs a heading to plot each reading against, and
this robot's ultrasonic is bolted to the chassis facing forward — sweeping it
would mean sweeping the whole robot. Mount the sensor on a servo and it
becomes worth doing.

**No flash persistence.** The rover remembers its screen choice through the
hidden `settings` extension, which has to be added to `pxt.json` by hand. This
build starts in Status every time instead. No layout change either: `CFG` and
`CFG_REV` are untouched, so the app needs nothing.

# Web app v2.13 — Build / Play fully reviewed

Build and Play were reviewed as one system rather than patched independently. v2.13 makes geometry/state transitions deterministic, makes Play Fit/fullscreen robust on oversized canvases, cleans runtime listeners and Arrange interactions, and ensures connected Play uses only a verified device CFG.

Highlights:

- Build → Play → Build preserves widget geometry and canvas dimensions.
- Fit / 1:1 / zoom / fullscreen are view-only.
- Play Arrange is zoom-correct and cannot accidentally activate robot controls.
- Build and Play keep separate zoom preferences.
- Connected Play hides stale/unverified controls during connect or forced CFG reload.
- Play Fit ignores empty authoring space; 1:1 still exposes the complete canvas.
- Fullscreen Fit was validated from 640×900 through 1920×1080.
- Runtime document listeners/timers are cleaned across rerenders and mode changes.
- Group ownership is deterministic; separator sizing remains thin-friendly.

See **`BUILD_PLAY_REVIEW.md`** for the detailed invariants, fixes, and regression matrix.

Firmware remains **v52**; this release is web-only.

## v2.11 — Trim Canvas

Build includes an explicit **Trim Canvas** command for users who intentionally want to change the logical/exported canvas around occupied widgets. It is separate from Fit: Trim changes design geometry/canvas bounds and is Undo/Redo-aware; Fit only changes the view.

<!-- Recovered from README.html, where these entries lived only as loose
     fragments outside the document body. -->

## Web v2.13 — Build / Play fully reviewed

Build and Play now use a deterministic state model: mode switches and view controls never rewrite geometry, disconnected Play deep-clones Build, connected Play uses only verified device CFG, Arrange is zoom-correct and command-safe, runtime listeners are lifecycle-cleaned, and Fit/fullscreen handle oversized canvases without clipping or dead space. Responsive Play/fullscreen checks passed from 640×900 through 1920×1080. Firmware remains v52.

## Web v2.10 — Play Fit Content

Play Fit uses occupied widget bounds instead of empty authoring canvas space, while preserving the logical CFG geometry and 1:1 view.

## Web v2.4 — Stable Build/Play geometry

Fixed Build → Import → Play → Build changing widget positions. Automatic Tidy on resize/tab switch has been removed. Build is the authoritative model and Play renders a deep-cloned snapshot; only explicit Tidy or Play/Arrange edits may change geometry.

## Web v2.3 — Fit large imported designs

Build now uses a scrollable, zoomable editor viewport without changing the logical CFG canvas. Imports automatically fit the whole design. Use **Fit Design**, +/−, 1:1, mouse-wheel/controls, normal scroll, or Alt/Option + drag to navigate large layouts while preserving exact export geometry.

## Web v2.2 — Group + Line

Build now includes config-native **Group** and **Line/Separator** widgets. Groups can capture child widget IDs and move the whole functional section together; line separators support horizontal/vertical orientation, subtle/solid/dashed styles, thickness, color and an optional label. Both survive Layout JSON and MakeCode CFG export.

## Web v2.1 — Portable layout export

Build and Play/Arrange can export the exact design as **Layout JSON** or a **MakeCode CFG** TypeScript snippet. Both include the canvas geometry and a fresh deterministic config revision.

## v51 — Config-defined reference layout

The MakeCode CFG now carries the approved **1372 × 776** layout, including widget positions/sizes and an explicit canvas size. The web app v2.1 honors that canvas metadata. Config revision: `47c78c1f`. Control behavior remains v50.

## v50 — Heartbeat follows Telemetry

Heartbeat is now controlled by the Telemetry selector in every drive mode: **All/Basic** send heartbeat, while **Off** is silent. Line/Avoid motor activity no longer suppresses the heartbeat. The widget configuration is unchanged.

## v49 — Distance Read selector

The MakeCode CFG now includes a **Distance read** selector with **Auto** and **Read now**. Read now takes one ultrasonic sample in any drive mode and updates the distance gauge and graph, then returns the selector to Auto.

## Web app 2.0

The web application version is now **2.0**. A single very discreet Bismillah appears at the absolute top. Firmware remains v50.

## v2.11

Build adds Trim Canvas to remove unused logical canvas space while preserving relative widget layout and supporting Undo/Redo.
