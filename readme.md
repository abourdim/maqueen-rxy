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
