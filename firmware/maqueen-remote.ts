/**
 * ╔════════════════════════════════════════════════════════════════╗
 * ║            🎮 Micro:bit Remote Builder (bit-rxy) 🎮            ║
 * ║                                                                ║
 * ║   Powered by Workshop-DIY.org                                  ║
 *   Maqueen Lite: D-pad drive, servo sliders, LEDs, buzzer         ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * 📋 PROJECT: Maqueen Remote
 *
 * bit-rxy-generated skeleton for the "Maqueen" layout (D-pad drive,
 * STOP, Buzz, LED L/R toggles, Servo 1/2 sliders), with handleWidget()
 * filled in to drive a real DFRobot Maqueen Lite via the pxt-maqueen
 * extension.
 *
 * The D-pad → motor mix below is ported directly from Maqueen Lab's
 * own proven drive-pad code (js/maqueen-tab.js): it boils down to a
 * normalized (nx, ny) vector — nx = turn (right positive), ny =
 * forward (up positive) — fed through the same differential-drive
 * formula:
 *     L = clamp(ref * (ny + nx), -ref, ref)
 *     R = clamp(ref * (ny - nx), -ref, ref)
 * with the same 12%-of-full-scale dead zone before treating input as
 * "stopped", so behavior should match what Maqueen Lab's own UI does.
 *
 * ════════════════════════════════════════════════════════════════
 * ⚡ LOW-LATENCY D-PAD — REAL-HARDWARE LESSONS (v43)
 * ════════════════════════════════════════════════════════════════
 *
 * This section records the latency investigation so the same problems
 * do not get reintroduced later. The final v43 path was reached by
 * testing each layer separately: browser pointer event → Web Bluetooth
 * write → micro:bit UART receive callback → Maqueen I2C motor write.
 * v43 was the first build that felt immediate in real driving tests.
 *
 * 1) REMOVE ARTIFICIAL UI/QUEUE DELAYS
 *    - The browser originally waited ~60 ms between BLE writes.
 *    - D-pad release had a 100 ms debounce.
 *    Those two delays were directly visible as press/stop latency and
 *    were removed. D-pad uses Pointer Events so touch devices do not
 *    generate a second synthetic mouse sequence after the touch.
 *
 * 2) DO NOT REPLAY OLD MOTOR EVENTS
 *    A reliable FIFO sounds safe, but it is wrong for steering: a stale
 *    press/release queued ahead of the newest direction makes the robot
 *    faithfully execute OLD intentions. Manual drive therefore uses
 *    "latest complete state wins", not "deliver every historical click".
 *    The state is a 4-bit mask: Up=1, Down=2, Left=4, Right=8. This also
 *    preserves diagonals naturally.
 *
 * 3) KEEP THE RADIO PACKET TINY
 *    The old text protocol could exceed the BLE UART payload used by the
 *    app. For example "SET dpad_move up 1" fit while down/left/right were
 *    longer and could require another BLE write/connection event. We
 *    first shortened the command, then removed text parsing entirely.
 *    FINAL FORMAT: one ASCII byte 'a'..'p' encodes mask 0..15, followed
 *    by newline. The browser therefore writes exactly TWO bytes for a
 *    D-pad state change.
 *
 * 4) BYPASS THE GENERAL BLE QUEUE FOR MOTORS
 *    Sliders, PINGs and other controls may be serialized/coalesced by the
 *    normal app queue. The D-pad has its own writer and replaces any
 *    pending motor state with the newest one. At most the GATT write
 *    already in progress can finish first; stale motor states do not
 *    build a backlog.
 *
 * 5) EXECUTE MOTORS DIRECTLY IN THE RECEIVE CALLBACK
 *    The one-byte packet is detected before GETCFG/SET parsing and goes
 *    straight to handleDpadMask(). That hot path does only: decode mask,
 *    calculate left/right speed, and call motorStop()/motorRun(). It does
 *    NOT call handleWidget(), dbg(), LED rendering, telemetry, or the
 *    generic drive refresh/rate-limit path.
 *
 * 6) NEVER BLOCK THE BLE RECEIVE CALLBACK WITH DISPLAY OR LOGGING
 *    basic.showArrow/showIcon/showLeds normally include hundreds of ms
 *    of display time unless interval 0 is supplied. Earlier firmware
 *    rendered arrows inside the receive path, producing ~400-600 ms of
 *    apparent control lag. Display work is now deferred to the forever
 *    loop and uses interval 0.
 *
 *    serial.writeLine() was another trap: with no USB serial reader it
 *    can block the calling fiber. bluetooth.uartWriteLine() from inside
 *    onUartDataReceived was also found to interfere with BLE turnaround.
 *    dbg() therefore only queues text; optional BLE logs drain later from
 *    the main loop, and debugging defaults OFF.
 *
 * 7) ULTRASONIC POLLING CAN FREEZE THE WHOLE RUNTIME
 *    pxt-maqueen Ultrasonic() retries pulseIn() when there is no echo.
 *    On open space this can busy-wait for roughly 250 ms. That freeze
 *    also freezes BLE command handling, so a perfectly fast D-pad packet
 *    still appears late. The latency build NEVER polls Ultrasonic() in
 *    Manual or Line mode; distance sensing is reserved for Avoid mode.
 *
 * 8) BACKGROUND BLE TRAFFIC MATTERS
 *    Telemetry/logs/heartbeat traffic shares the same BLE link with motor
 *    commands. The Telemetry selector is the explicit policy switch:
 *    All/Basic may send the lightweight heartbeat, while Off is fully
 *    silent. Expensive sensor work is still suppressed in Manual, app PING
 *    traffic is sparse around driving, and the D-pad writer has priority.
 *    bluetooth.setTransmitPower(7) is used for the strongest
 *    link available from MakeCode.
 *
 * 9) MOTOR I2C WRITES: CHANGE IMMEDIATELY, DO NOT SPAM
 *    Maqueen motors are controlled over I2C. Generic joystick/servo code
 *    still avoids redundant writes, but the D-pad hot path writes a real
 *    state change immediately. Do not restore a fixed 125 ms/8 Hz delay
 *    to handleDpadMask(); that turns directly into steering latency.
 *
 * 10) KEEP SAFETY WITHOUT MAKING CONTROL SLUGGISH
 *    A held direction is periodically re-sent as the SAME complete mask.
 *    The firmware watchdog stops the motors if those refreshes disappear,
 *    protecting against a lost release/link while still letting a held
 *    button stay active. Link-loss handling also stops both motors.
 *
 * IMPORTANT DESIGN RULE: for real-time drive controls, optimize for the
 * newest desired STATE, not guaranteed delivery of every EVENT. Reliability
 * for an old steering command is often indistinguishable from latency.
 *
 *
 * ════════════════════════════════════════════════════════════════
 * 💓 v50 — HEARTBEAT FOLLOWS TELEMETRY, NOT DRIVE MODE
 * ════════════════════════════════════════════════════════════════
 * Earlier builds suppressed heartbeat whenever the motors had been
 * updated recently. That was useful while chasing Manual D-pad latency,
 * but in Line/Avoid the motors are updated continuously by autonomous
 * code, so the UI looked as if the heartbeat had stopped.
 *
 * v50 makes the Telemetry selector the single source of truth:
 *   • All   -> heartbeat + full telemetry
 *   • Basic -> heartbeat + firmware version only
 *   • Off   -> no heartbeat / no optional telemetry
 *
 * The heartbeat counter still advances once per second internally.
 * sendValue() applies the selected telemetry level before anything is
 * written over BLE. Therefore Manual, Line and Avoid now have the same
 * heartbeat semantics, and changing mode no longer changes whether the
 * connection appears alive.
 *
 * Extension required (MakeCode → Extensions):
 *   • pxt-maqueen   (https://github.com/DFRobot/pxt-maqueen)
 *   • pxt-oled-ssd1306 (https://github.com/tinkertanker/pxt-oled-ssd1306)
 *     — the 128x64 OLED. Omit it and this file will not compile.
 *
 * 🔌 SCREEN WIRING: SSD1306 128x64 on the I2C header, address 0x3C. It
 *    shares the bus with the Maqueen motor driver at 0x10 — the boot
 *    splash reports whether both ACKed, so a mis-wired screen or a dead
 *    driver is visible before anything else is debugged.
 *
 * 🖥️ SCREEN MODES — the Screen selector in the app, or button A on the
 *    micro:bit, which cycles the same three. Either drives it and both stay
 *    in step: A pushes its new value back to the app, and a fresh connect
 *    reports the mode the robot is really in rather than assuming Status.
 *    Status  text: link, drive mode, speed, motors, distance, line sensors
 *            -- and while DISCONNECTED, the pairing name, because the
 *            browser's chooser lists every board as "BBC micro:bit [xxxxx]"
 *            and picking your own out of a classroom is otherwise a guess
 *    Face    two eyes drawn from a framebuffer, with moods
 *    Auto    Status until the app connects, then Face
 *    Radar   a sonar map -- REQUIRES THE ULTRASONIC ON SERVO 1. Left on the
 *            chassis every reading lands at the same heading and the scope
 *            draws one spoke, which is honestly all the robot can see.
 *            Radar head: Sweep pans by itself, Aim follows the Servo 1
 *            slider. Either way, leaving the radar hands the horn back to
 *            wherever the slider thinks it is.
 *
 *    FACE STYLES, cycled by button B or the app's Face style selector:
 *    Round, Circle, Robot, Big, Visor. A style is a look, not a behaviour --
 *    all five blink, worry, startle and sleep. How far the pupils can travel
 *    is CLAMPED per style against that style's own geometry rather than by a
 *    shared constant: a circular eye has under half a rectangle's room, and a
 *    pupil is a hole, so one that reaches the border opens the eye into a C.
 *
 *    The app's Message field types onto the glass: while it is set it owns
 *    the top two rows and the status keeps the rest, and clearing it hands
 *    those rows back.
 *
 *    FACE MOODS, in the order they outrank each other:
 *      happy    logo touched (V2)      a deliberate request beats every mood
 *                                      the robot works out for itself
 *      alarm    picked up or tipped    small pupils, eyes down
 *      startle  obstacle just arrived  small pupils, eyes up and wide, 550ms
 *      dizzy    just spun on the spot  pupils rolling, 2s
 *      worried  something close ahead  brows down, driven by the sonar
 *      asleep   20s with no command    eyes shut
 *      open     otherwise: blinks, and one blink in four is a wink
 *
 *    startle fires on the CROSSING into obstacle range, not on the condition:
 *    watching the flag itself would leave the robot staring wide-eyed for as
 *    long as it sat near a wall, which is a stare rather than a fright.
 *
 *    WHERE THE EYES LOOK. Driving, they follow the D-pad, diagonals included,
 *    and setting off after a rest earns one blink. Parked, they follow
 *    whichever line sensor is over the line: the rover's eyes follow its
 *    sweep head, and this robot has no head, so the line beneath it is the
 *    one thing it is actually looking at.
 *
 *    A face frame is 1024 bytes on the bus the motors use, so v58 froze the
 *    face outright while the wheels turned. v59 does not have to: a glance
 *    changes only when a button does, and an unchanged frame is dropped, so
 *    holding a direction costs exactly one frame. The 180ms ration in
 *    faceRender is a floor under a mashed D-pad, not a frame rate.
 *
 * 🚀 HOW TO USE:
 *    1. Copy this entire file's contents
 *    2. Go to https://makecode.microbit.org
 *    3. Create new project → Switch to JavaScript mode
 *    4. Add the pxt-maqueen extension (Extensions → search "maqueen")
 *       and paste the pxt-oled-ssd1306 URL above into the same dialog
 *    5. Paste this code → Download to micro:bit
 *    6. Open bit-rxy (or maqueen-rxy) and connect — the app requests
 *       the layout automatically (GETCFG) and builds the D-pad,
 *       STOP/Buzz buttons, LED toggles and servo sliders.
 *
 * ⚠️ Note on debugging: use dbg() (not serial.writeLine directly) for
 * anything you want to see while testing. It logs over BLE as
 * "LOG <msg>" lines — the app already console.logs every raw BLE line
 * it receives, so dbg() output shows up in the browser DevTools
 * console (F12) with nothing but the BLE connection already open, no
 * USB cable needed. General controls can request LED-matrix diagnostics,
 * but the v43 D-pad hot path intentionally does no display work at all;
 * nothing visual is allowed between the BLE packet and motorRun().
 *
 * 🖥️ LED MATRIX LEGEND — every glyph is distinct on purpose, so the
 * robot can be read untethered without a cable or console:
 *    "v43"        scrolling at boot   — firmware version (check after every flash)
 *    ○            hollow ring         — powered up, idle, waiting for BLE
 *    filling grid pixel by pixel      — sending the layout (GETCFG)
 *    ✓            tick                — connected, layout delivered
 *    ✗            cross               — BLE link lost (motors auto-stopped)
 *    ■            square              — STOP button pressed
 *    ↑ ↓ ← →      arrow               — driving in that direction
 *    ·            centre dot          — motors idle (direction released)
 *    ◇            small diamond       — only one wheel driving
 *    ▌ left band  solid / corners     — LED L toggled on / off
 *    ▐ right band solid / corners     — LED R toggled on / off
 *    ♪            quarter note        — Buzz pressed
 *    bar graph    rising bar          — servo angle (0-180)
 *
 * Most non-drive controls leave a visual mark. The D-pad is the one
 * deliberate exception: visual feedback was removed from its hot path
 * because responsiveness is more important than per-packet animation.
 *
 * 🔌 Wire protocol (bit-rxy's own, NOT Maqueen Lab's #N/ECHO: dialect):
 *    App → micro:bit   <a..p> + newline        (FAST D-pad: 1-byte mask)
 *    App → micro:bit   SET <widgetId> <value...>
 *    App → micro:bit   GETCFG                 (asks for the layout once, on connect)
 *    micro:bit → App   CFGBEGIN <chunkCount> / CFG <b64 chunk> / CFGEND
 *    micro:bit → App   UPD <widgetId> <value>  (optional — push sensor/status updates)
 */

// Bump this on every real change and check it (serial log + LED scroll
// at boot) to confirm what's actually flashed before debugging further —
// no more guessing whether a fix was really re-flashed.
const FIRMWARE_VERSION = "v61"

// Debug helper — logs ONLY if debugEnabled is true (default false).
// THIS IS THE ROOT CAUSE of "connected, but nothing happens": pxt-
// microbit's serial.writeLine() BLOCKS THE CALLING FIBER when nothing
// is actively reading the USB serial output — which is the normal
// case once you unplug USB and just drive over BLE. v6/v7 called
// dbg()/serial.writeLine() unconditionally on every single command,
// from INSIDE the BLE receive handler, BEFORE the actual motorRun/
// servoRun/writeLED call — so in real untethered use, every command
// handler hung forever right at the logging line and the hardware
// action never ran. It only looked like it worked during debugging
// sessions because USB + the serial monitor happened to be open and
// actively draining the buffer at that moment. Maqueen Lab's own
// firmware has the exact same landmine and defends against it by
// defaulting logging OFF — same fix here. Flip debugEnabled to true
// to see dbg() output over BLE as "LOG <msg>" lines, which the app
// already console.logs for every raw line it receives — so it shows
// up in the browser DevTools console (F12) with the app just
// connected, no USB cable needed at all.
//
// dbg() deliberately does NOT call serial.writeLine() anymore — an
// earlier version of this file did, and it reintroduced the exact
// blocking landmine described above: with only BLE connected (no USB
// serial monitor actively reading), serial.writeLine() blocks the
// calling fiber forever, so the very first dbg() call inside
// handleWidget() hung before the real hardware action ever ran —
// nothing worked at all, not even the log. The queue avoids blocking
// entirely: dbg() only ever PUSHES a string (fast, non-blocking). The
// actual bluetooth.uartWriteLine() call happens later, from the main
// loop below — NEVER synchronously from inside onUartDataReceived.
// Calling uartWriteLine() directly inside the receive handler on every
// command was also tried once before (the "v5" attempt) and broke
// everything (GETCFG hung again), because it raced the BLE stack's own
// turnaround right as a packet was still being processed. Draining one
// line per 100ms loop tick, exactly like the heartbeat, avoids both
// problems.
let debugEnabled = false
let logQueue: string[] = []
const LOG_QUEUE_MAX = 20
function dbg(msg: string) {
    if (!debugEnabled) return
    logQueue.push(msg)
    if (logQueue.length > LOG_QUEUE_MAX) logQueue.shift()
}

// ═══════════════════════════════════════════════════════════════
// 🔌 BLUETOOTH SETUP
// ═══════════════════════════════════════════════════════════════

bluetooth.startUartService()
bluetooth.setTransmitPower(7)
let cfgSent = false

// v48 CONFIG-NATIVE GAUGES + v47 FAST RECONNECT + v46 HARDENING
// ----------------------------------------------
// v46 fixed stale BLE sessions, but still retransmitted an unchanged layout
// on every reconnect. v47 adds a revision handshake:
//   GETCFGVER -> CFGVER <hash>
//   cache hit -> CFGOK <hash>        (no layout transfer)
//   cache miss -> GETCFG             (existing paced transfer)
// The browser caches by BluetoothDevice.id and the robot remains source of
// truth because any layout change produces a different CFG_REV.
//
// v46 RECONNECT HARDENING
// -----------------------
// GETCFG used to send ~2 seconds of CFGBEGIN/CFG/CFGEND notifications from
// INSIDE onUartDataReceived(). That works on a cold boot, but after a real
// disconnect/reconnect the BLE UART stack can be in a fragile turnaround
// state; a large callback-side write burst can leave the device visible in
// the chooser while config notifications no longer flow. Queue the transfer
// here and let the main loop send ONE notification at a time instead.
let cfgTxActive = false
let cfgTxStage = 0       // 0=CFGBEGIN, 1=CFG chunks, 2=CFGEND
let cfgTxPos = 0
let cfgTxChunkIdx = 0
let cfgTxLit = 0
let cfgTxNextAt = 0
const CFG_TX_GAP_MS = 35

// v47: config revision probe. Never write the reply from inside the UART RX
// callback; even this tiny response is queued to the main loop to preserve the
// reconnect hardening learned in v46.
let cfgVerPending = false
let cfgVerReplyAt = 0

// A real disconnect can also leave the Nordic/MakeCode BLE peripheral in a
// connectable-but-unusable GATT state until reset. v46 schedules a SOFTWARE
// reset after showing X, so the user no longer needs the physical reset button.
let bleStackResetAt = 0
const BLE_STACK_RESET_DELAY_MS = 600

// ── LINK LOSS DETECTION BY SILENCE ───────────────────────────────
// bluetooth.onBluetoothDisconnected does NOT fire on this board. Tested
// directly: an explicit gatt.disconnect() from the app never produced
// the ✗, so every safety behaviour hanging off that event — stopping the
// motors when the link drops — has never actually run. A robot driving
// when the connection died would have kept going.
//
// onBluetoothConnected DOES fire (the heartbeat is gated on btConnected
// and it counts), so it is specifically the disconnect event that is
// unreliable. Rather than depend on it, the link is now judged by
// traffic: the app pings every three seconds, lastRxAt is stamped on ANY line
// received, and silence past LINK_TIMEOUT_MS means the peer is gone.
//
// 9s allows roughly two missed 3s pings before declaring the link dead, which is
// tolerant of a momentarily busy radio without leaving a runaway robot
// driving for long.
let lastRxAt = 0
let linkLostHandled = false
const LINK_TIMEOUT_MS = 9000

// True while the link is known alive. Set by onBluetoothConnected() AND,
// from v45 onward, by every successfully received UART line. The receive
// fallback matters because Manual commands can work in the UART callback even
// when a missed connection event would otherwise leave Line/Avoid and UPD
// telemetry disabled in the forever loop.
// Every bluetooth.uartWriteLine() in this file is gated on it, because
// writing to a UART with no peer BLOCKS THE CALLING FIBER once the
// buffer stops draining — the identical failure mode as serial.
// writeLine(). Maqueen Lab's firmware keeps the same flag for the same
// reason. cfgSent is NOT a substitute: it only tracks whether the
// layout was delivered, and it stays true across a link drop until the
// disconnect handler runs.
let btConnected = false

// ── TELEMETRY LEVEL ──────────────────────────────────────────────
// How much the robot pushes back to the app. Everything the firmware
// reports — uptime, distance, line sensors, obstacle alert — is a UPD
// write, and each one competes with the drive commands coming the other
// way. Turning it down is the cheapest way to free the radio.
//
//   All   — everything (default)
//   Basic — uptime and version only, so the link still visibly lives
//   Off   — silence
//
// Firmware starts at All to match the first/default option shown by the app.
// Manual driving still suppresses expensive sensor work, so this does not
// reintroduce the old D-pad latency problem.
//
// Note this does NOT affect link-loss detection: that measures traffic
// arriving FROM the app (its PING), so the robot still notices a dead
// link at Off. Nor does it disable the app's controls, which are the
// other direction entirely.
const UPD_OFF = 0
const UPD_BASIC = 1
const UPD_ALL = 2
let updLevel = UPD_ALL

// 🧭 v51 — CONFIG-DEFINED 1372 × 776 REFERENCE LAYOUT
// ---------------------------------------------------
// The widget geometry below now matches the agreed Arrange-mode reference.
// Unlike earlier releases, the canvas size is also stored in CFG:
//     "canvas":{"w":1372,"h":776}
// so compatible clients can reproduce the same composition instead of
// recalculating a different board size from widget extents.
//
// This is deliberately a configuration/layout change only. The v50 control,
// heartbeat, distance selector, BLE reconnect and low-latency motor behavior
// remain unchanged.
//
// 📦 Remote layout config (Base64 encoded JSON, 2389 bytes, 21 widgets).
// v48 CONFIG-NATIVE GAUGES
// ------------------------
// Servo 1, Servo 2 and Speed now each have a REAL `t:"gauge"` widget
// stored here in the MakeCode-delivered configuration. The gauges are no
// longer synthesized by one particular web app, so every compatible app
// receives the same IDs, positions, ranges, labels and model.
//
// Control/gauge pairs:
//   slider_srv1 -> gauge_srv1   0..180°
//   slider_srv2 -> gauge_srv2   0..180°
//   spd         -> gauge_spd    60..255
//
// Each gauge also carries `source:"<slider id>"`. Newer clients can mirror
// it locally with zero BLE traffic; older clients still receive paced
// `UPD gauge_* <value>` packets from this firmware.
//
// The config also includes initial `value` fields (90°, 90°, 200), matching
// the actual boot state, so even before telemetry arrives the controls do
// not falsely show minimum.
//
// DESIGN RULE LEARNED:
// If a visual relationship must look the same in several apps, define it
// as widgets + metadata in CFG. Do not hide it in app-specific CSS/JS.
//
// v52: derive the config revision from the actual embedded Base64 CFG.
// Any CFG byte change automatically changes CFGVER; no manual hash can go stale.
function cfgRevisionFromCfg(text: string): string {
    let hash = 5381 >>> 0
    for (let i = 0; i < text.length; i++) {
        hash = ((((hash << 5) + hash) ^ text.charCodeAt(i)) >>> 0)
    }
    return "d" + (hash >>> 0)
}

const CFG = "eyJ0aXRsZSI6Ik1hcXVlZW4gUmVtb3RlIiwid2lkZ2V0cyI6W3siaWQiOiJncnBfZHJpdmUiLCJ0IjoiZ3JvdXAiLCJsYWJlbCI6IkRSSVZFIiwiY29sb3IiOiIjMDBkNGZmIiwieCI6NTYsInkiOjQyLCJ3Ijo5MzcsImgiOjY4MiwiY2hpbGRyZW4iOiJkcGFkX21vdmUsc3BkLGJ0bl9zdG9wLGdhdWdlX3NwZCxidG5fbWwsYnRuX21yIn0seyJpZCI6ImdycF9oZWFkIiwidCI6Imdyb3VwIiwibGFiZWwiOiJIRUFEIiwiY29sb3IiOiIjZmY5NTAwIiwieCI6NTYsInkiOjc2MiwidyI6NjYxLCJoIjoyODUsImNoaWxkcmVuIjoic2xpZGVyX3NydjEsZ2F1Z2Vfc3J2MSxzbGlkZXJfc3J2MixnYXVnZV9zcnYyIn0seyJpZCI6ImdycF9saWdodCIsInQiOiJncm91cCIsImxhYmVsIjoiTElHSFRTICYgU09VTkQiLCJjb2xvciI6IiNjMDg0ZmMiLCJ4Ijo3MzYsInkiOjc2MiwidyI6MjYyLCJoIjozNDgsImNoaWxkcmVuIjoidG9nZ2xlX2xlZF9sLHRvZ2dsZV9sZWRfcixidG5fYnV6eiJ9LHsiaWQiOiJncnBfZGlzdCIsInQiOiJncm91cCIsImxhYmVsIjoiRElTVEFOQ0UiLCJjb2xvciI6IiNmZmIwMjAiLCJ4IjoxMDM2LCJ5Ijo0MiwidyI6NTI5LCJoIjo2ODAsImNoaWxkcmVuIjoiZ2F1Z2VfZGlzdCxhbGVydCxkaXN0X3JlYWQsZ3JhcGhfZGlzdCJ9LHsiaWQiOiJncnBfYXV0byIsInQiOiJncm91cCIsImxhYmVsIjoiQVVUT05PTVkiLCJjb2xvciI6IiMwMGU2NzYiLCJ4IjoxMDM2LCJ5Ijo3NTIsInciOjQyMSwiaCI6MTg3LCJjaGlsZHJlbiI6ImxuX2wsbG5fcixtb2RlIn0seyJpZCI6ImdycF9zY3IiLCJ0IjoiZ3JvdXAiLCJsYWJlbCI6IlNDUkVFTiIsImNvbG9yIjoiIzM4YmRmOCIsIngiOjU2LCJ5IjoxMTIyLCJ3Ijo4ODgsImgiOjI5NCwiY2hpbGRyZW4iOiJzY3JlZW5fbW9kZSxvbGVkX3RleHQsbGJsX29sZWQsZmFjZV9zdHlsZSxoZWFkX21vZGUifSx7ImlkIjoiZ3JwX3N5cyIsInQiOiJncm91cCIsImxhYmVsIjoiU1lTVEVNIiwiY29sb3IiOiIjODg5MmIwIiwieCI6MTAzNiwieSI6OTYyLCJ3Ijo0MTUsImgiOjI3NiwiY2hpbGRyZW4iOiJsYmxfdmVyLGxibF9oZWFydGJlYXQsdXBkIn0seyJpZCI6InNlcF9jb2xzIiwidCI6InNlcGFyYXRvciIsIngiOjEwMTIsInkiOjEwMCwidyI6OCwiaCI6NjgwfSx7ImlkIjoic2VwX2xlZnQiLCJ0Ijoic2VwYXJhdG9yIiwieCI6ODAsInkiOjc0NSwidyI6ODkwLCJoIjo4fSx7ImlkIjoic2VwX3J0MSIsInQiOiJzZXBhcmF0b3IiLCJ4IjoxMDYwLCJ5Ijo3MzAsInciOjQ5MCwiaCI6OH0seyJpZCI6InNlcF9ydDIiLCJ0Ijoic2VwYXJhdG9yIiwieCI6MTA2MCwieSI6OTQ2LCJ3Ijo0OTAsImgiOjh9LHsiaWQiOiJkcGFkX21vdmUiLCJ0IjoiZHBhZCIsIngiOjgwLCJ5IjoxMDAsInciOjQ0OSwiaCI6NDU2LCJsYWJlbCI6IkRyaXZlIiwibW9kZWwiOiJjbGFzc2ljIn0seyJpZCI6InNwZCIsInQiOiJzbGlkZXIiLCJ4Ijo1NjAsInkiOjEwMCwidyI6MTQ4LCJoIjoyNjIsImxhYmVsIjoiU3BlZWQiLCJtaW4iOjYwLCJtYXgiOjI1NSwic3RlcCI6NSwidmFsdWUiOjIwMH0seyJpZCI6ImJ0bl9zdG9wIiwidCI6ImJ1dHRvbiIsIngiOjc0MCwieSI6MTAwLCJ3IjoxMDcsImgiOjExNSwibGFiZWwiOiJTVE9QIn0seyJpZCI6ImdhdWdlX3NwZCIsInQiOiJnYXVnZSIsIngiOjc0MCwieSI6MjUwLCJ3IjoyMjksImgiOjI1MiwibGFiZWwiOiJTcGVlZCIsIm1pbiI6NjAsIm1heCI6MjU1LCJ1bml0cyI6IiIsImRlY2ltYWxzIjowLCJtb2RlbCI6Im1pbiIsInNvdXJjZSI6InNwZCIsInZhbHVlIjoyMDB9LHsiaWQiOiJidG5fbWwiLCJ0IjoiYnV0dG9uIiwieCI6ODAsInkiOjU4MCwidyI6MjAwLCJoIjoxMjAsImxhYmVsIjoiTGVmdCBtb3RvciIsImljb24iOiLimpnvuI8iLCJzcGluIjotMSwiY29sb3IiOiIjMGU3NDkwIn0seyJpZCI6ImJ0bl9tciIsInQiOiJidXR0b24iLCJ4IjozMDAsInkiOjU4MCwidyI6MjAwLCJoIjoxMjAsImxhYmVsIjoiUmlnaHQgbW90b3IiLCJpY29uIjoi4pqZ77iPIiwic3BpbiI6MSwiY29sb3IiOiIjMGU3NDkwIn0seyJpZCI6InNsaWRlcl9zcnYxIiwidCI6InNsaWRlciIsIngiOjgwLCJ5Ijo4MjAsInciOjk5LCJoIjoyMDMsImxhYmVsIjoiU2Vydm8gMSIsIm1pbiI6MCwibWF4IjoxODAsInN0ZXAiOjEsInZhbHVlIjo5MH0seyJpZCI6ImdhdWdlX3NydjEiLCJ0IjoiZ2F1Z2UiLCJ4IjoyMDAsInkiOjgyMCwidyI6MTY0LCJoIjoxODUsImxhYmVsIjoiU2Vydm8gMSIsIm1pbiI6MCwibWF4IjoxODAsInVuaXRzIjoiwrAiLCJkZWNpbWFscyI6MCwibW9kZWwiOiJtaW4iLCJzb3VyY2UiOiJzbGlkZXJfc3J2MSIsInZhbHVlIjo5MH0seyJpZCI6InNsaWRlcl9zcnYyIiwidCI6InNsaWRlciIsIngiOjQwMCwieSI6ODIwLCJ3Ijo5OSwiaCI6MjAxLCJsYWJlbCI6IlNlcnZvIDIiLCJtaW4iOjAsIm1heCI6MTgwLCJzdGVwIjoxLCJ2YWx1ZSI6OTB9LHsiaWQiOiJnYXVnZV9zcnYyIiwidCI6ImdhdWdlIiwieCI6NTIwLCJ5Ijo4MjAsInciOjE3MywiaCI6MTgxLCJsYWJlbCI6IlNlcnZvIDIiLCJtaW4iOjAsIm1heCI6MTgwLCJ1bml0cyI6IsKwIiwiZGVjaW1hbHMiOjAsIm1vZGVsIjoibWluIiwic291cmNlIjoic2xpZGVyX3NydjIiLCJ2YWx1ZSI6OTB9LHsiaWQiOiJ0b2dnbGVfbGVkX2wiLCJ0IjoidG9nZ2xlIiwieCI6NzYwLCJ5Ijo4MjAsInciOjk3LCJoIjoxMjEsImxhYmVsIjoiTEVEIEwifSx7ImlkIjoidG9nZ2xlX2xlZF9yIiwidCI6InRvZ2dsZSIsIngiOjg3NywieSI6ODIwLCJ3Ijo5NywiaCI6MTIxLCJsYWJlbCI6IkxFRCBSIn0seyJpZCI6ImJ0bl9idXp6IiwidCI6ImJ1dHRvbiIsIngiOjc2MCwieSI6OTY1LCJ3IjoxMDgsImgiOjEyMSwibGFiZWwiOiJCdXp6In0seyJpZCI6ImdhdWdlX2Rpc3QiLCJ0IjoiZ2F1Z2UiLCJ4IjoxMDYwLCJ5IjoxMDAsInciOjI2NCwiaCI6MTg3LCJsYWJlbCI6IkRpc3RhbmNlIiwibWluIjowLCJtYXgiOjIwMCwidW5pdHMiOiJjbSIsImRlY2ltYWxzIjowLCJtb2RlbCI6ImNsYXNzaWMifSx7ImlkIjoiYWxlcnQiLCJ0Ijoibm90aWZpY2F0aW9uIiwieCI6MTM1MCwieSI6MTAwLCJ3Ijo5MCwiaCI6MTg2LCJsYWJlbCI6IkFsZXJ0In0seyJpZCI6ImRpc3RfcmVhZCIsInQiOiJzZWxlY3QiLCJ4IjoxMDYwLCJ5IjozMjAsInciOjE5NCwiaCI6NjIsImxhYmVsIjoiRGlzdGFuY2UgcmVhZCIsIm9wdGlvbnMiOiJBdXRvLFJlYWQgbm93In0seyJpZCI6ImdyYXBoX2Rpc3QiLCJ0IjoiZ3JhcGgiLCJ4IjoxMDYwLCJ5Ijo0MDAsInciOjQ4MSwiaCI6Mjk4LCJsYWJlbCI6IkRpc3RhbmNlIGNtIiwibW9kZWwiOiJncmlkIiwid2luZG93U2VjIjozMCwic2VyaWVzIjoxfSx7ImlkIjoibG5fbCIsInQiOiJsZWQiLCJ4IjoxMDYwLCJ5Ijo4MTAsInciOjc2LCJoIjoxMDUsImxhYmVsIjoiTGluZSBMIiwibW9kZWwiOiJkb3QiLCJjb2xvck9uIjoiIzRhZGU4MCJ9LHsiaWQiOiJsbl9yIiwidCI6ImxlZCIsIngiOjExNTYsInkiOjgxMCwidyI6NzgsImgiOjEwNSwibGFiZWwiOiJMaW5lIFIiLCJtb2RlbCI6ImRvdCIsImNvbG9yT24iOiIjNGFkZTgwIn0seyJpZCI6Im1vZGUiLCJ0Ijoic2VsZWN0IiwieCI6MTI1NCwieSI6ODIwLCJ3IjoxNzksImgiOjkyLCJsYWJlbCI6Ik1vZGUiLCJvcHRpb25zIjoiTWFudWFsLExpbmUsQXZvaWQifSx7ImlkIjoic2NyZWVuX21vZGUiLCJ0Ijoic2VsZWN0IiwieCI6ODAsInkiOjExODAsInciOjIwMCwiaCI6OTIsImxhYmVsIjoiU2NyZWVuIiwib3B0aW9ucyI6IlN0YXR1cyxGYWNlLEF1dG8sUmFkYXIifSx7ImlkIjoib2xlZF90ZXh0IiwidCI6ImVkaXRmaWVsZCIsIngiOjMyMCwieSI6MTE4MCwidyI6MzIwLCJoIjo5MiwibGFiZWwiOiJNZXNzYWdlIn0seyJpZCI6ImxibF9vbGVkIiwidCI6ImxhYmVsIiwieCI6NjgwLCJ5IjoxMTgwLCJ3IjoyNDAsImgiOjkyLCJsYWJlbCI6Ik9uIHNjcmVlbiJ9LHsiaWQiOiJmYWNlX3N0eWxlIiwidCI6InNlbGVjdCIsIngiOjgwLCJ5IjoxMzAwLCJ3IjoyMDAsImgiOjkyLCJsYWJlbCI6IkZhY2Ugc3R5bGUiLCJvcHRpb25zIjoiUm91bmQsQ2lyY2xlLFJvYm90LEJpZyxWaXNvciJ9LHsiaWQiOiJoZWFkX21vZGUiLCJ0Ijoic2VsZWN0IiwieCI6MzIwLCJ5IjoxMzAwLCJ3IjoyMDAsImgiOjkyLCJsYWJlbCI6IlJhZGFyIGhlYWQiLCJvcHRpb25zIjoiU3dlZXAsQWltIn0seyJpZCI6ImxibF92ZXIiLCJ0IjoibGFiZWwiLCJ4IjoxMDYwLCJ5IjoxMDIwLCJ3IjoxMDksImgiOjc5LCJsYWJlbCI6IkZpcm13YXJlIn0seyJpZCI6ImxibF9oZWFydGJlYXQiLCJ0IjoibGFiZWwiLCJ4IjoxMTkwLCJ5IjoxMDIwLCJ3IjoyMzcsImgiOjc2LCJsYWJlbCI6IlVwdGltZSJ9LHsiaWQiOiJ1cGQiLCJ0Ijoic2VsZWN0IiwieCI6MTA2MCwieSI6MTEyMCwidyI6MTgyLCJoIjo5NCwibGFiZWwiOiJUZWxlbWV0cnkiLCJvcHRpb25zIjoiQWxsLEJhc2ljLE9mZiJ9XSwiY2FudmFzIjp7InciOjE2MjEsImgiOjE0NzJ9fQ=="
// v52: computed from CFG itself at boot.
let CFG_REV = cfgRevisionFromCfg(CFG)

// ═══════════════════════════════════════════════════════════════
// 📡 BLUETOOTH COMMUNICATION
// ═══════════════════════════════════════════════════════════════

bluetooth.onUartDataReceived(serial.delimiters(Delimiters.NewLine), function () {
    let cmd = bluetooth.uartReadUntil(serial.delimiters(Delimiters.NewLine))

    // Stamp on EVERY line, whatever it is — including the app's PING,
    // which exists purely to keep this fresh while nobody is driving.
    // This is what the link-loss timeout below measures against.
    lastRxAt = input.runningTime()
    linkLostHandled = false

    // v45: receiving a UART packet is stronger evidence of a live BLE link
    // than the platform connection callback. Manual D-pad commands execute
    // inside this receive handler, but Line/Avoid + telemetry run in the
    // forever loop and are gated on btConnected. If onBluetoothConnected()
    // is missed on a device/browser combination, Manual still appears to
    // work while BOTH autonomous modes and all UPD telemetry stay dead.
    // Any successfully received packet proves the peer is connected, so
    // recover the flag here. Link loss is still detected by RX silence.
    btConnected = true

    // Fastest D-pad wire format: one byte 'a'..'p' encodes mask 0..15.
    // The browser sends exactly two bytes total: command + newline.
    if (cmd.length == 1 && cmd.charCodeAt(0) >= 97 && cmd.charCodeAt(0) <= 112) {
        handleDpadMask(cmd.charCodeAt(0) - 97)
    }
    else if (cmd == "BYE") {
        // Intentional app disconnect: stop safely and schedule a clean BLE
        // peripheral reboot before the next session.
        handleLinkLost()
    }
    else if (cmd == "GETCFGVER") {
        // v47 fast reconnect: answer with only the layout revision first.
        // The browser can reuse its cached config and avoid the ~2 second
        // CFGBEGIN/CFG/CFGEND stream when nothing changed.
        cfgVerPending = true
        cfgVerReplyAt = input.runningTime() + 20
    }
    else if (cmd.indexOf("CFGOK ") == 0) {
        // Cache-hit acknowledgement from the browser. cfgSent means
        // "the peer has a usable layout", not strictly "we transmitted CFG
        // this session". This keeps Line/Avoid + telemetry enabled on the
        // fast reconnect path.
        let rev = cmd.substr(6)
        if (rev == CFG_REV) {
            cfgSent = true
            cfgTxActive = false
            versionSent = false
            scheduleInitialUiSync()
            requestGlyph(GLYPH_CONNECTED)
        }
    }
    else if (cmd == "GETCFG") {
        // v46: arm the transfer and RETURN from the RX callback immediately.
        // The forever loop below emits CFGBEGIN/chunks/CFGEND one at a time.
        dbg("GETCFG received (firmware " + FIRMWARE_VERSION + "), queueing layout...")
        cfgSent = false
        cfgTxActive = true
        cfgTxStage = 0
        cfgTxPos = 0
        cfgTxChunkIdx = 0
        cfgTxLit = 0
        cfgTxNextAt = input.runningTime() + 20
        debugDirty = false
        basic.clearScreen()
    }
    else if (cmd.indexOf("M ") == 0) {
        // Ultra-low-latency D-pad packet. The number is the COMPLETE
        // current button state (U=1,D=2,L=4,R=8), so stale queued events
        // never need to be replayed.
        handleDpadMask(parseInt(cmd.substr(2)))
    }
    else if (cmd.indexOf("D ") == 0) {
        // Compact D-pad packet: D <u|d|l|r> <0|1>. Keeping this under
        // one 20-byte BLE payload avoids an extra connection event.
        let parts = cmd.split(" ")
        let d = parts[1]
        let dir = d == "u" ? "up" : d == "d" ? "down" : d == "l" ? "left" : "right"
        handleWidget("dpad_move", dir + " " + parts[2])
    }
    else if (cmd.indexOf("SET ") == 0) {
        let parts = cmd.substr(4).split(" ")
        let id = parts[0]
        let val = parts.slice(1).join(" ")
        handleWidget(id, val)
    }
})

// ═══════════════════════════════════════════════════════════════
// 🕹️ DRIVE MIX — ported from Maqueen Lab's js/maqueen-tab.js
// joystick handler. nx = turn (right positive), ny = forward
// (up positive), both in -1..1. DRIVE_REF matches the 200 (not 255)
// ceiling Maqueen Lab itself uses — deliberately leaves headroom
// rather than maxing out the motor driver.
// ═══════════════════════════════════════════════════════════════

// Top speed, now live-adjustable from the Speed slider instead of a
// constant. 200 (not 255) remains the default, matching the ceiling
// Maqueen Lab uses — it deliberately leaves headroom rather than
// maxing out the motor driver. Autonomous modes below use it too, so
// one slider governs manual and self-driving alike.
let driveSpeed = 200

// v48 UI MIRROR STATE
// -------------------
// The Servo 1, Servo 2 and Speed gauges are real widgets in CFG.
// Do NOT transmit their UPD messages from the BLE RX callback: v46 showed
// that callback-side TX can destabilize reconnects. Handlers only mark the
// latest value dirty; the forever loop coalesces and publishes it later.
let uiServo1 = 90
let uiServo2 = 90
let uiGaugeSrv1Dirty = false
let uiGaugeSrv2Dirty = false
let uiGaugeSpdDirty = false
let uiGaugeLastInputAt = 0
let uiGaugeTxNextAt = 0
let uiInitialSyncStage = 0
const UI_GAUGE_SETTLE_MS = 90
const UI_GAUGE_TX_GAP_MS = 45

function scheduleInitialUiSync() {
    uiInitialSyncStage = 1
    uiGaugeTxNextAt = input.runningTime() + 80
}

function sendUiValue(id: string, val: string) {
    // These are control-state mirrors, not optional sensor telemetry.
    if (!btConnected || !cfgSent) return
    bluetooth.uartWriteLine("UPD " + id + " " + val)
}

const DRIVE_SPEED_MIN = 60      // below this the motors stall rather than crawl
const DRIVE_SPEED_MAX = 255
const DEAD_ZONE = 0.12  // below this magnitude on both axes, treat as stopped

// Visual-only diagnostic — no USB required. Shows what the firmware
// computed for the last drive command directly on the 5x5 LED matrix:
// an arrow for the dominant direction, or a small square when stopped.
//
// ⚠️ NEVER CALL THIS FROM THE BLE RECEIVE HANDLER. Every basic.show*
// function RENDERS AND THEN PAUSES for its interval argument — the
// defaults are ~600ms for showArrow and ~400ms for showLeds/showIcon.
// Earlier versions called this straight from driveMix(), i.e. from
// inside onUartDataReceived, so every press blocked the receive
// callback ~600ms and every release ~400ms. A release routinely
// arrived while the handler was still blocked on the press's arrow,
// which is what made directions go missing and stalled the heartbeat
// (the watchdog called it from the forever loop too, blocking that).
//
// Maqueen Lab's own firmware is the reference here: its drive path
// (handleMotor) issues the two motorRun() calls and NOTHING else —
// every basic.showArrow/showIcon call in that file belongs to a
// dedicated display verb (JOY:UP, SHOW:, icon names), never to the
// motor path. That is the entire difference between the firmware
// that works and the one that didn't.
//
// So: driveMix() only records what it wants drawn (pendingDebugL/R +
// debugDirty), and the forever loop renders it here with an explicit
// interval of 0 so nothing ever pauses.
function showDriveDebug(l: number, r: number) {
    if (l == 0 && r == 0) {
        basic.showLeds(`
            . . . . .
            . . . . .
            . . # . .
            . . . . .
            . . . . .
            `, 0)
    } else if (l > 0 && r > 0) {
        basic.showArrow(ArrowNames.North, 0)       // both forward
    } else if (l < 0 && r < 0) {
        basic.showArrow(ArrowNames.South, 0)       // both backward
    } else if (l < 0 && r > 0) {
        basic.showArrow(ArrowNames.West, 0)        // spin left
    } else if (l > 0 && r < 0) {
        basic.showArrow(ArrowNames.East, 0)        // spin right
    } else {
        basic.showIcon(IconNames.SmallDiamond, 0)  // one wheel only
    }
}

// What driveMix() wants drawn, rendered later by the forever loop.
// Kept separate from lastDriveL/lastDriveR because those are also the
// I2C rate-limit's "what's currently spinning" state — conflating the
// two would re-render on every rate-limited refresh.
let pendingDebugL = 0, pendingDebugR = 0
let debugDirty = false
// Which glyph the loop should paint. ONE renderer, in the forever loop,
// is the whole point: event handlers (BLE connect/disconnect, STOP) used
// to call basic.show* directly while the loop was also drawing. Those
// run on different fibers, so a handler's icon could be overwritten by a
// showDriveDebug() call the loop had already committed to — which is why
// the ✗ on disconnect never stuck and the micro:bit kept showing ✓.
// Clearing debugDirty could not prevent it: the loop had already passed
// that check. Handlers now only ever REQUEST a glyph.
const GLYPH_DRIVE = 0
const GLYPH_STOP = 1
const GLYPH_DISCONNECTED = 2
const GLYPH_CONNECTED = 3
const GLYPH_LED_L = 4
const GLYPH_LED_R = 5
const GLYPH_BUZZ = 6
const GLYPH_SERVO = 7
let pendingGlyph = GLYPH_DRIVE
// Extra payload for glyphs that show a value: 0/1 for the LED toggles,
// 0-180 for the servo bar graph.
let pendingValue = 0

function requestGlyph(g: number) {
    pendingGlyph = g
    debugDirty = true
}
function requestGlyphValue(g: number, v: number) {
    pendingValue = v
    requestGlyph(g)
}
function requestDriveDebug(l: number, r: number) {
    // The pendingGlyph term matters: after STOP or a disconnect has
    // painted its own icon, the next release (0,0) must still repaint the
    // dot even though pendingDebugL/R already read 0,0.
    if (l == pendingDebugL && r == pendingDebugR && pendingGlyph == GLYPH_DRIVE) return
    pendingDebugL = l
    pendingDebugR = r
    pendingGlyph = GLYPH_DRIVE
    debugDirty = true
}
function requestStopIcon() {
    pendingDebugL = 0
    pendingDebugR = 0
    requestGlyph(GLYPH_STOP)
}

// The Maqueen Lite motor driver is I2C-based (not direct PWM). Generic
// continuous controls still use change detection so they do not hammer
// I2C with essentially identical values. HOWEVER, real-hardware latency
// testing showed that a fixed 125 ms / 8 Hz gate is unacceptable for
// manual steering. MIN_DRIVE_INTERVAL_MS is therefore ZERO in this
// latency build, and the dedicated D-pad path below bypasses driveMix()
// altogether so every actual state change reaches motorRun immediately.
// Keep the change threshold for noisy continuous controls; do not add a
// fixed time gate back into handleDpadMask().
let lastDriveL = 0, lastDriveR = 0
let lastDriveAt = 0
const MIN_DRIVE_INTERVAL_MS = 0    // latency build: state changes write immediately
const DRIVE_CHANGE_THRESHOLD = 15  // ignore jitter smaller than this

// Safety watchdog for the final state-mask protocol. A held D-pad
// periodically re-sends the SAME complete mask (currently ~1000 ms in
// script.js). That refresh is not for steering fidelity; it is a safety
// heartbeat. If the physical release or BLE link disappears, the robot
// must not keep driving forever. 2500 ms leaves room for missed refreshes
// without making a normal held button cut out. Every fresh mask stamps
// lastDriveCmdAt, and link-loss handling independently stops the motors.
let lastDriveCmdAt = 0
const DRIVE_WATCHDOG_MS = 2500

// ═══════════════════════════════════════════════════════════════
// 🤖 DRIVING MODES
// Manual = the D-pad drives. Line / Avoid run autonomously from the
// forever loop. Every autonomous step is a plain state update — no
// blocking waits — so the radio, watchdog and display keep running.
// ═══════════════════════════════════════════════════════════════
const MODE_MANUAL = 0
const MODE_LINE = 1
const MODE_AVOID = 2
let driveMode = MODE_MANUAL

// Line sensors. IMPORTANT: readPatrol returns 0 when the sensor is OVER
// THE BLACK LINE and 1 when it is over pale floor — inverted from what
// "1 = detected" would suggest. Maqueen Lab documents this explicitly
// ("0 (on black line) or 1 (on white floor)"). The LED widgets are fed
// the inverted value so that a LIT led means "this side is on the line",
// which is what anyone watching would expect.
let lastLineL = -1
let lastLineR = -1
const LINE_INTERVAL_MS = 100

// Obstacle-avoid + alert thresholds.
const AVOID_STOP_CM = 20        // back away closer than this
const ALERT_CM = 25             // notify the app below this
const ALERT_CLEAR_CM = 40       // ...and only re-arm once well clear again
// Declared up here with the other distance limits rather than beside the
// polling loop that also uses it: the radar reads it too, and the radar is
// drawn from the screen section far above that loop. Static TypeScript rejects
// use-before-declaration, so the constant has to lead both readers.
const DIST_MAX_CM = 200         // matches the gauge's max in CFG
let alertActive = false
// The version label is pushed once per session, from the main loop.
// Deliberately NOT sent from the GETCFG handler: writing to the UART
// synchronously inside onUartDataReceived is what broke the handshake in
// the v5 attempt. The loop sends it on the first tick after cfgSent.
let versionSent = false
// Avoid runs as a timed reverse-then-turn so nothing blocks the loop.
let avoidUntil = 0
let avoidPhase = 0              // 0 = cruising, 1 = reversing, 2 = turning

// Declared up here (not next to the forever loop that uses them)
// because onBluetoothDisconnected resets them, and that handler appears
// earlier in the file — static TypeScript rejects use-before-declaration.
let heartbeat = 0

function driveMix(nx: number, ny: number) {
    if (Math.abs(nx) < DEAD_ZONE && Math.abs(ny) < DEAD_ZONE) {
        maqueen.motorStop(maqueen.Motors.All)
        dbg("drive: STOP (nx=" + nx + " ny=" + ny + ")")
        requestDriveDebug(0, 0)
        lastDriveL = 0
        lastDriveR = 0
        lastDriveAt = input.runningTime()
        return
    }
    let l = Math.constrain(Math.round((ny + nx) * driveSpeed), -driveSpeed, driveSpeed)
    let r = Math.constrain(Math.round((ny - nx) * driveSpeed), -driveSpeed, driveSpeed)

    let now = input.runningTime()
    let changedEnough = Math.abs(l - lastDriveL) >= DRIVE_CHANGE_THRESHOLD || Math.abs(r - lastDriveR) >= DRIVE_CHANGE_THRESHOLD
    let dueForRefresh = (now - lastDriveAt) >= MIN_DRIVE_INTERVAL_MS
    if (!changedEnough && !dueForRefresh) {
        return  // skip redundant/too-frequent I2C write
    }

    // Drive path, deliberately identical in shape to Maqueen Lab's
    // handleMotor(): two motorRun() calls and nothing that can block.
    // dbg() only pushes to a queue; requestDriveDebug() only sets a
    // flag. No basic.show* here — see showDriveDebug()'s comment.
    maqueen.motorRun(maqueen.Motors.M1, l >= 0 ? maqueen.Dir.CW : maqueen.Dir.CCW, Math.abs(l))
    maqueen.motorRun(maqueen.Motors.M2, r >= 0 ? maqueen.Dir.CW : maqueen.Dir.CCW, Math.abs(r))
    dbg("drive: nx=" + nx + " ny=" + ny + " -> L=" + l + " R=" + r)
    requestDriveDebug(l, r)
    lastDriveL = l
    lastDriveR = r
    lastDriveAt = now
}

// Same rate-limit/change-detection guard as driveMix(), applied to the
// servo sliders — see the comment at the slider_srv1/2 handlers above.
let lastServo1 = -1, lastServo2 = -1
let lastServo1At = 0, lastServo2At = 0
function servoWriteAllowed(port: number, angle: number): boolean {
    let now = input.runningTime()
    let last = port == 1 ? lastServo1 : lastServo2
    let lastAt = port == 1 ? lastServo1At : lastServo2At
    let changedEnough = Math.abs(angle - last) >= DRIVE_CHANGE_THRESHOLD
    let dueForRefresh = (now - lastAt) >= MIN_DRIVE_INTERVAL_MS
    if (!changedEnough && !dueForRefresh) {
        return false
    }
    if (port == 1) { lastServo1 = angle; lastServo1At = now }
    else { lastServo2 = angle; lastServo2At = now }
    return true
}

// D-pad direction state, driven by the dpad_move handler in
// handleWidget() below. More than one can be true at once (e.g. up+
// right held together) for a diagonal.
let btnFwd = false, btnBack = false, btnLeft = false, btnRight = false
function updateButtonDrive() {
    let ny = 0, nx = 0
    if (btnFwd) ny += 1
    if (btnBack) ny -= 1
    if (btnLeft) nx -= 1
    if (btnRight) nx += 1
    driveMix(nx, ny)
}

function handleDpadMask(mask: number) {
    if (driveMode != MODE_MANUAL) return
    // HOT PATH: a D-pad packet goes straight to the Maqueen motor driver.
    // Do not route through handleWidget()/dbg()/LED rendering/rate limiting.
    // Those are useful for general controls but add scheduler and BLE work
    // exactly when manual driving needs the lowest possible latency.
    lastDriveCmdAt = input.runningTime()
    btnFwd = (mask & 1) != 0
    btnBack = (mask & 2) != 0
    btnLeft = (mask & 4) != 0
    btnRight = (mask & 8) != 0

    let ny = 0, nx = 0
    if (btnFwd) ny += 1
    if (btnBack) ny -= 1
    if (btnLeft) nx -= 1
    if (btnRight) nx += 1

    if (nx == 0 && ny == 0) {
        maqueen.motorStop(maqueen.Motors.All)
        lastDriveL = 0
        lastDriveR = 0
        lastDriveAt = lastDriveCmdAt
        return
    }

    let l = Math.constrain((ny + nx) * driveSpeed, -driveSpeed, driveSpeed)
    let r = Math.constrain((ny - nx) * driveSpeed, -driveSpeed, driveSpeed)
    maqueen.motorRun(maqueen.Motors.M1, l >= 0 ? maqueen.Dir.CW : maqueen.Dir.CCW, Math.abs(l))
    maqueen.motorRun(maqueen.Motors.M2, r >= 0 ? maqueen.Dir.CW : maqueen.Dir.CCW, Math.abs(r))
    lastDriveL = l
    lastDriveR = r
    lastDriveAt = lastDriveCmdAt
}

// ═══════════════════════════════════════════════════════════════
// 🛞 PER-WHEEL JOG BUTTONS (v55)
// Two buttons that each run ONE wheel forward, so you can see which
// motor is which and prove both turn the same way. The app sends
// "SET btn_ml 1" on press and "SET btn_ml 0" on release, so these are
// held, not clicked — and because each button's state is tracked
// separately, holding BOTH runs both wheels and the robot goes straight.
//
// State is kept here rather than derived from lastDriveL/lastDriveR: those
// are also written by the D-pad and by Line/Avoid, so reading them back
// would let an autonomous step masquerade as a held button.
// ═══════════════════════════════════════════════════════════════
let jogL = false
let jogR = false

function applyJog() {
    if (driveMode != MODE_MANUAL) return
    let l = jogL ? driveSpeed : 0
    let r = jogR ? driveSpeed : 0
    lastDriveCmdAt = input.runningTime()
    if (l == 0 && r == 0) {
        maqueen.motorStop(maqueen.Motors.All)
        lastDriveL = 0
        lastDriveR = 0
        lastDriveAt = lastDriveCmdAt
        requestDriveDebug(0, 0)
        return
    }
    // Always forward — these are "does this wheel work" buttons, not steering.
    maqueen.motorRun(maqueen.Motors.M1, maqueen.Dir.CW, l)
    maqueen.motorRun(maqueen.Motors.M2, maqueen.Dir.CW, r)
    lastDriveL = l
    lastDriveR = r
    lastDriveAt = lastDriveCmdAt
    requestDriveDebug(l, r)
}

// Called by the disconnect/link-lost paths. Without this a button held at the
// moment the link drops would still read as pressed on reconnect, and the
// first applyJog() would start a wheel nobody asked for.
function clearJog() {
    jogL = false
    jogR = false
}

// ═══════════════════════════════════════════════════════════════
// 🎮 WIDGET HANDLERS — driving real Maqueen hardware via pxt-maqueen
// ═══════════════════════════════════════════════════════════════

// v44 autonomous motor path. Manual D-pad packets have their own direct
// path above; Line/Avoid need the same ownership model. Autonomous motion
// is generated on the micro:bit, so it must not depend on browser D-pad
// keepalives or the Manual drive watchdog.
function driveAuto(nx: number, ny: number) {
    if (driveMode == MODE_MANUAL) return
    let now = input.runningTime()
    if (Math.abs(nx) < DEAD_ZONE && Math.abs(ny) < DEAD_ZONE) {
        maqueen.motorStop(maqueen.Motors.All)
        lastDriveL = 0
        lastDriveR = 0
        lastDriveAt = now
        lastDriveCmdAt = now
        requestDriveDebug(0, 0)
        return
    }
    let l = Math.constrain(Math.round((ny + nx) * driveSpeed), -driveSpeed, driveSpeed)
    let r = Math.constrain(Math.round((ny - nx) * driveSpeed), -driveSpeed, driveSpeed)
    maqueen.motorRun(maqueen.Motors.M1, l >= 0 ? maqueen.Dir.CW : maqueen.Dir.CCW, Math.abs(l))
    maqueen.motorRun(maqueen.Motors.M2, r >= 0 ? maqueen.Dir.CW : maqueen.Dir.CCW, Math.abs(r))
    lastDriveL = l
    lastDriveR = r
    lastDriveAt = now
    lastDriveCmdAt = now
    requestDriveDebug(l, r)
}
// ═══════════════════════════════════════════════════════════════
// 🖥️ OLED 128x64 (SSD1306, I2C 0x3C)
// ═══════════════════════════════════════════════════════════════
// Extension: https://github.com/tinkertanker/pxt-oled-ssd1306  (namespace OLED)
//
// WHY 128x64 AND NOT 128x32. That library hardcodes the two registers which
// tell an SSD1306 how many rows it has, for a 64-row panel. Give it a 32-row
// panel and it initialises to something unreadable until 0xA8/0x1F and
// 0xDA/0x02 are poked in by hand over raw I2C afterwards — dfrobot-rover
// carries exactly that workaround. At 64 rows the library's own defaults are
// already correct, so there is nothing to correct here.
//
// THE BUS IS THE CONSTRAINT, NOT THE SCREEN. The Maqueen's motor driver is
// itself on I2C, and this firmware already records (see the servo slider
// handler) that unthrottled writes can lock that bus hard enough to freeze
// the whole runtime, heartbeat included. A repaint is roughly ten I2C
// transactions per character, so a full 8x21 screen is on the order of 1700
// of them. Three rules keep the screen from ever becoming that third talker
// at the wrong moment:
//
//   1. NEVER FROM THE BLE RECEIVE PATH. Rendering happens in the forever
//      loop only, exactly like the LED matrix — see "DISPLAY FIRST, RADIO
//      LAST" there. The v43 D-pad hot path stays free of display work.
//   2. NEVER WHILE THE WHEELS TURN. A screen a second behind while driving
//      costs nothing; a motor write stuck behind 1700 transactions does.
//   3. NEVER WHEN NOTHING CHANGED. Which puts a real constraint on what may
//      appear here: anything that ticks on its own forces a repaint at its
//      own rate. That is why the uptime below is shown in MINUTES and the
//      distance is quantised to 5 cm — a seconds clock would repaint the
//      whole panel once a second, forever, for no information anyone needs
//      on the robot itself. Parked and connected, this screen should be
//      redrawing essentially never.
const OLED_ADDR = 0x3C
const MAQUEEN_I2C_ADDR = 0x10    // the motor driver, checked by the splash
const OLED_COLS = 21             // characters across at the default font
const OLED_ROWS = 8              // 64 rows / 8-pixel font
// How often we may LOOK, not how often we draw. Building the strings and
// comparing them costs no I2C at all, so this can be brisk; only an actual
// change reaches the bus. It has to be brisk, too — a blink is 140ms shut,
// and at 250ms most blinks would open and close unseen between two checks.
// The rover runs the same 120.
const OLED_REFRESH_MS = 120
const OLED_SPLASH_MS = 3500

// A missing panel must cost nothing at all. Without this every refresh would
// spend its transactions writing into the void, on the bus the motors need.
let oledOk = false
let oledSplashUntil = 0
let oledCheckAt = 0
let oledOnGlass: string[] = []
let oledLineL = 0
let oledLineR = 0
// The distance poll below keeps its reading here; nothing else retains one.
let lastDistShown = -1
// A message typed in the app. While it is set it owns the top of the status
// screen; clearing the field gives the status rows back.
let oledText = ""
// What the app was last told is on the glass, so lbl_oled is only pushed when
// it actually changes rather than on every tick.
let oledLastReported = "\u0000"

// Zero-length write: the address either ACKs or it does not. Cheaper and
// more honest than writing a byte somewhere and hoping it was harmless.
function i2cPresent(addr: number): boolean {
    const b = pins.createBuffer(1)
    b[0] = 0x00
    return pins.i2cWriteBuffer(addr, b, false) == 0
}

function oledPad(s: string, w: number): string {
    while (s.length < w) s = s + " "
    return s
}

// Right-aligned, so 99 -> 100 does not shove the rest of the line sideways.
function oledNum(n: number, w: number): string {
    let s = "" + n
    while (s.length < w) s = " " + s
    return s
}

function oledSigned(n: number): string {
    return n > 0 ? "+" + n : "" + n
}

function oledInit() {
    oledOk = i2cPresent(OLED_ADDR)
    if (!oledOk) {
        dbg("oled: nothing ACKed at 0x3C, screen disabled")
        return
    }
    OLED.init(128, 64)
    OLED.clear()
    oledOnGlass = []
    for (let i = 0; i < OLED_ROWS; i++) oledOnGlass.push("")
}

// Shown for a couple of seconds at power-up, before anything connects. It
// answers the two questions a bench test actually starts with: is the screen
// wired, and did the motor driver ACK? A robot that boots to a blank panel is
// indistinguishable from one with a dead battery.
// A robot fails on a bench in a handful of ways -- sonar lead off, driver not
// seen, a line sensor unplugged, flat pack -- and the answer used to be a
// teacher crouching over it with a phone and an app. This answers it from
// across the table with nothing connected at all.
//
// Every line is a MEASUREMENT, not a claim: "Driver 0x10 ok" means the address
// ACKed just now, and "Sonar 45 cm" means a pulse came back. A test that
// cannot fail tells you nothing, so nothing here is hardcoded to pass.
function oledSelfTest() {
    if (!oledOk) return
    const driver = i2cPresent(MAQUEEN_I2C_ADDR) ? "ok" : "MISSING"
    // One reading, once. Ultrasonic() costs ~250ms when nothing echoes back
    // (see the polling notes below) and that is affordable exactly once, here.
    const cm = maqueen.Ultrasonic()
    const sonar = cm >= 500 ? "clear"
        : cm > 0 ? ("" + cm + " cm")
        : "NO ECHO"
    // Raw pin values, not the inverted "on the line" sense the app shows: an
    // unplugged sensor reads a constant, and seeing which constant is the
    // whole point of a bring-up screen.
    const rawL = maqueen.readPatrol(maqueen.Patrol.PatrolLeft)
    const rawR = maqueen.readPatrol(maqueen.Patrol.PatrolRight)
    OLED.clear()
    OLED.writeStringNewLine("Workshop-DIY.org")
    OLED.writeStringNewLine("Maqueen      " + FIRMWARE_VERSION)
    // The pairing name, at the first moment anyone would want it.
    OLED.writeStringNewLine("micro:bit " + control.deviceName())
    OLED.writeStringNewLine("Screen 0x3C   ok")
    OLED.writeStringNewLine("Driver 0x10   " + driver)
    OLED.writeStringNewLine("Sonar    " + sonar)
    OLED.writeStringNewLine("Line     L " + rawL + "   R " + rawR)
    OLED.writeStringNewLine("")
    dbg("selftest: driver=" + driver + " sonar=" + sonar
        + " line=" + rawL + "/" + rawR)
    // Whatever the screen shows next must repaint over this.
    for (let i = 0; i < OLED_ROWS; i++) oledOnGlass[i] = ""
}

// The eight lines, built fresh and compared before anything is drawn.
function oledLines(): string[] {
    const out: string[] = []
    if (oledText.length > 0) {
        // A typed message owns the top rows; the status keeps the rest. Two
        // rows, so 42 characters arrive whole rather than being cut at 21.
        out.push(oledText.substr(0, OLED_COLS))
        out.push(oledText.length > OLED_COLS
            ? oledText.substr(OLED_COLS, OLED_COLS) : "")
    } else {
        out.push("Workshop-DIY.org")
        out.push(oledPad("Maqueen", 13) + FIRMWARE_VERSION)
    }
    // Minutes, not seconds — see rule 3 above.
    out.push(btConnected
        ? "BLE   up " + Math.idiv(heartbeat, 60) + "m"
        : "Connect to:")
    // Disconnected, the useful thing is WHICH micro:bit this is. The browser's
    // chooser lists them as "BBC micro:bit [xxxxx]" and they all look alike,
    // so picking your own out of a classroom is otherwise a guess -- and the
    // drive mode this row usually carries is meaningless while disconnected,
    // since the link dropping resets it to Manual anyway.
    out.push(btConnected
        ? "Mode  " + (driveMode == MODE_LINE ? "Line"
            : driveMode == MODE_AVOID ? "Avoid" : "Manual")
        : "micro:bit " + control.deviceName())
    out.push("Speed " + oledNum(driveSpeed, 3))
    out.push("Motor L" + oledPad(oledSigned(lastDriveL), 5) + "R" + oledSigned(lastDriveR))
    // Quantised to 5 cm so sensor jitter alone cannot drive a repaint.
    out.push("Dist  " + (lastDistShown < 0
        ? "  --" : oledNum(Math.idiv(lastDistShown, 5) * 5, 4)) + " cm")
    // A lit mark means "this side is over the line" — the inverted sense
    // documented at lastLineL, so the screen agrees with the app's LEDs.
    out.push("Line  L" + (oledLineL == 1 ? "*" : ".") + "  R" + (oledLineR == 1 ? "*" : "."))
    return out
}

// ── RAW COMMAND CHANNEL ─────────────────────────────────────────────
// The extension can draw text and nothing else worth having. Everything
// below talks to the panel directly.
function oledCmd(c: number) {
    const b = pins.createBuffer(2)
    b[0] = 0x00                  // "a command follows"
    b[1] = c
    pins.i2cWriteBuffer(OLED_ADDR, b)
}

// ── FRAMEBUFFER ─────────────────────────────────────────────────────
// The face cannot be drawn with the OLED extension. drawFilledCircle() calls
// drawLine() once per column, every drawLine() ends in drawShape(), and
// drawShape() spends six command writes plus a data write for EACH
// column-page it touches: one filled circle is several hundred I2C
// transactions. So the face keeps its own framebuffer and pushes whole
// frames — sixteen writes of 65 bytes for the entire screen, against ten
// transactions per character on the text path.
//
// 1024 bytes at 64 rows, twice the rover's. That is nothing on a V2, and it
// is allocated once at boot, never per frame.
const FB_W = 128
const FB_PAGES = 8
const FB_SIZE = FB_W * FB_PAGES
let fb: Buffer = null
let fbTx: Buffer = null          // reused, so drawing a frame allocates nothing

function fbInit() {
    if (!oledOk) return
    fb = pins.createBuffer(FB_SIZE)
    fbTx = pins.createBuffer(65)
    fbTx[0] = 0x40               // "data follows", once, for every chunk
}

// Bytes are VERTICAL: bit b of page p is row p*8+b. Filling by column-page
// with a mask keeps this to at most 128x8 writes rather than one per pixel,
// which matters because this runs in the MakeCode interpreter, not in C.
function fbRect(x: number, y: number, w: number, h: number, on: boolean) {
    const y0 = Math.max(0, y)
    const y1 = Math.min(FB_PAGES * 8 - 1, y + h - 1)
    const x0 = Math.max(0, x)
    const x1 = Math.min(FB_W - 1, x + w - 1)
    if (y1 < y0 || x1 < x0) return
    for (let page = y0 >> 3; page <= (y1 >> 3); page++) {
        const top = Math.max(y0, page * 8)
        const bot = Math.min(y1, page * 8 + 7)
        let mask = 0
        for (let b = top; b <= bot; b++) mask = mask | (1 << (b & 7))
        for (let px = x0; px <= x1; px++) {
            const i = page * FB_W + px
            fb[i] = on ? (fb[i] | mask) : (fb[i] & (~mask & 0xFF))
        }
    }
}

function fbFlush() {
    oledCmd(0x21); oledCmd(0); oledCmd(FB_W - 1)        // column window
    oledCmd(0x22); oledCmd(0); oledCmd(FB_PAGES - 1)    // page window
    for (let off = 0; off < FB_SIZE; off += 64) {
        for (let i = 0; i < 64; i++) fbTx[i + 1] = fb[off + i]
        pins.i2cWriteBuffer(OLED_ADDR, fbTx, false)
    }
}

// ── RADAR ───────────────────────────────────────────────────────────
// The rover's sonar map, and it needs the same thing the rover has: a sensor
// that can look somewhere other than straight ahead. A Maqueen's ultrasonic
// is bolted to the chassis, so THIS SCREEN ONLY MEANS ANYTHING IF THE SENSOR
// IS MOUNTED ON SERVO 1. Left on the chassis, every reading lands at the same
// heading and the scope draws a single spoke -- which is exactly what it
// should draw, because that is all the robot can see.
//
// Each column of the picture is one heading and each mark is how close the
// nearest thing at that heading is, so the glass becomes a drawing of the room
// made by the robot rather than a number that changes.
const SCOPE_CX = 63
const SCOPE_CY = 63              // origin on the bottom edge
const SCOPE_R = 62
// The rover stretches its scope sideways by two: a half-disc that fits 32
// rows can only have a 31-pixel radius, which would leave two thirds of the
// width black. At 64 rows the radius reaches 62 and the semicircle is true,
// so there is nothing to stretch and no distortion to explain.
const BLIP_MAX = 48
const BLIP_LIFE_MS = 5000
let blipAngle: number[] = []
let blipCm: number[] = []
let blipAt: number[] = []
let radarFresh = true            // true = redraw the whole scope next time
let scopeBeamAt = -1             // beam angle currently on the glass
let scopeExpireAt = 0            // next sweep for blips that have aged out

// ── SWEEP HEAD (Servo 1) ────────────────────────────────────────────
// Driven from the loop by timestamps, never by pauses, so the radio and the
// drive watchdog keep running through a sweep. The limits stop short of the
// ends: a head that slams into the chassis at 0 or 180 stalls the servo,
// which draws current and buzzes rather than moving.
const HEAD_MIN = 30
const HEAD_MAX = 150
const HEAD_STEP = 6
const HEAD_STEP_MS = 140         // a step, plus room for the ping it triggers
let headAngle = 90
let headDir = 1
let nextHeadAt = 0
// Sweep pans the head on its own; Aim hands it to the Servo 1 slider and
// plots wherever it is pointed. Sweep by default, because a scope whose beam
// never moves is a distance gauge drawn the long way round.
let radarSweep = true

function fbPixel(x: number, y: number, on: boolean) {
    if (x < 0 || x >= FB_W || y < 0 || y >= FB_PAGES * 8) return
    const i = (y >> 3) * FB_W + x
    const bit = 1 << (y & 7)
    fb[i] = on ? (fb[i] | bit) : (fb[i] & (~bit & 0xFF))
}

// Deliberately NOT linear, and the same curve the app's radar widget uses so
// the two displays agree about what "close" looks like: the first 10cm gets a
// quarter of the radius. Close things are what matter, and on a linear scale
// they all pile up in the middle.
function scopeRadius(cm: number): number {
    let r = 0
    if (cm <= 0) r = 0
    else if (cm < 10) r = Math.idiv(cm * 40, 10)
    else if (cm < 30) r = 40 + Math.idiv((cm - 10) * 40, 20)
    else if (cm < 100) r = 80 + Math.idiv((cm - 30) * 80, 70)
    else r = 160
    // that scale is 0..160; this glass is 0..SCOPE_R
    return Math.idiv(r * SCOPE_R, 160)
}

function scopePlot(deg: number, r: number, on: boolean) {
    const rad = deg * Math.PI / 180
    fbPixel(SCOPE_CX + Math.round(r * Math.cos(rad)),
            SCOPE_CY - Math.round(r * Math.sin(rad)), on)
}

// Three range rings: 10, 30 and 100cm. The rover draws only two -- at 32 rows
// its 10cm ring lands at a 7-pixel radius and merely thickens the origin. Here
// it reaches 15 pixels and is a ring worth having, which is the same reason
// the scope needed no stretching.
//
// Drawn SOLID, one degree at a time. A dotted arc was the rover's first
// attempt and at this size it read as confetti, indistinguishable from the
// blips it is supposed to be a backdrop for. The inner rings are shorter arcs,
// so a coarser step is plenty there.
function scopeRings() {
    for (let a = 0; a <= 180; a++) scopePlot(a, scopeRadius(100), true)
    for (let a = 0; a <= 180; a += 2) scopePlot(a, scopeRadius(30), true)
    for (let a = 0; a <= 180; a += 4) scopePlot(a, scopeRadius(10), true)
    // The floor the rings stand on.
    fbRect(0, SCOPE_CY, FB_W, 1, true)
}

function scopeDraw(now: number) {
    fb.fill(0)
    scopeRings()
    // Live beam: solid, so it is obviously the thing that is moving.
    for (let r = 0; r <= SCOPE_R; r++) scopePlot(headAngle, r, true)
    // Everything the sweep has found lately.
    for (let i = 0; i < blipAngle.length; i++) {
        if (now - blipAt[i] > BLIP_LIFE_MS) continue
        const r = scopeRadius(blipCm[i])
        scopePlot(blipAngle[i], r, true)
        // A single pixel is 0.15mm. Two, and it is a mark.
        scopePlot(blipAngle[i], r - 1, true)
    }
    fbFlush()
}

// Blips persist and fade over five seconds, so a sweep builds a picture
// instead of showing one reading. Parallel arrays rather than objects: this
// runs in the MakeCode interpreter and a fixed ring of numbers costs nothing.
function radarPaint(angle: number, cm: number) {
    // Nothing bounced back is not a detection. Plotting it would draw a wall
    // at maximum range all the way round an empty room.
    if (cm > 0 && cm < DIST_MAX_CM) {
        blipAngle.push(angle)
        blipCm.push(cm)
        blipAt.push(input.runningTime())
        while (blipAngle.length > BLIP_MAX) {
            blipAngle.shift(); blipCm.shift(); blipAt.shift()
        }
    }
    radarFresh = false
    scopeDraw(input.runningTime())
}

// One sweep step: move, ping, plot. Called from the loop only while the radar
// screen is up and the wheels are still -- a sweep while driving would smear
// the picture across headings the robot no longer occupies, and the ping
// itself can stall for a quarter second when nothing echoes back.
function radarTick(now: number) {
    if (now < nextHeadAt) return
    nextHeadAt = now + HEAD_STEP_MS
    if (radarSweep) {
        headAngle += headDir * HEAD_STEP
        if (headAngle >= HEAD_MAX) { headAngle = HEAD_MAX; headDir = -1 }
        else if (headAngle <= HEAD_MIN) { headAngle = HEAD_MIN; headDir = 1 }
        maqueen.servoRun(maqueen.Servos.S1, headAngle)
    } else {
        // Aim: the slider already moved the horn, so this only has to agree
        // with it about where the horn is pointing. Writing the servo again
        // here would fight the slider for the same I2C bus and change nothing.
        headAngle = Math.constrain(uiServo1, 0, 180)
    }
    // Let the horn actually arrive before asking what is in front of it.
    // Timestamped rather than paused, like everything else in this loop.
    const cm = maqueen.Ultrasonic()
    if (cm > 0 && cm < 500) {
        lastDistShown = Math.min(cm, DIST_MAX_CM)
        radarPaint(headAngle, cm)
    } else {
        radarPaint(headAngle, -1)      // still redraw: the beam has moved
    }
}

// ── FACE ────────────────────────────────────────────────────────────
// Scaled up from the rover's 128x32 geometry. Doubling the height alone is
// not enough: at 64 rows the eyes have to grow sideways too, or they read as
// two tall slots rather than eyes. Margins stay even at 10px either side.
const EYE_W = 46, EYE_H = 44, EYE_Y = 10, EYE_LX = 10, EYE_RX = 72
const PUP = 20
const PUP_SMALL = 10
const BROW = 18                  // how deep the worried wedge cuts
const SMILE_Y = 29               // about two thirds down the eye
const FACE_OPEN = 0, FACE_SHUT = 1, FACE_WORRIED = 2, FACE_DIZZY = 3
const FACE_ALARM = 4             // picked up or tipped over
const FACE_HAPPY = 5             // logo touched
const FACE_STARTLE = 6           // something just appeared in front of it
const HAPPY_MS = 2200
// Shallow and thin, both settled by rendering it: a deeper or fatter arc
// fills solid across its flat middle and stops reading as a smile at all —
// it becomes a dome, which on a face is an eyebrow.
const HAPPY_DEPTH = 7
const HAPPY_THICK = 5
const FACE_SLEEP_MS = 20000
const FACE_BLINK_SHUT_MS = 140
const FACE_DIZZY_MS = 2000
// Obstacle startle. alertActive is the hysteretic "something is close" flag
// the distance poll already maintains; what matters for a face is its EDGE.
// Watching the flag itself would leave the robot staring wide-eyed for as long
// as it sat near a wall, which is a stare, not a fright. Catching the crossing
// makes it flinch once on approach and then settle into worried.
const FACE_STARTLE_MS = 550
let faceAlertSeen = false
let faceStartleUntil = 0

// A frame costs 1024 bytes on the bus the motors are using, so while the
// wheels turn the face is rationed rather than free. 180ms is a floor under a
// mashed D-pad, not a frame rate: faceSig already drops unchanged frames, so
// holding a direction still costs exactly one.
const FACE_DRIVE_MIN_MS = 180
let faceDriveNextAt = 0
// Blink on setting off, once per burst of driving -- the look of noticing
// where you are about to go, rather than a twitch on every button.
let faceWasDriving = false

// ── EYE STYLES ──────────────────────────────────────────────────────
// Five characters, one mood system. Every style still blinks, worries, is
// startled, falls asleep and winks -- what changes is the shape those
// expressions are drawn with, so a style is a look rather than a behaviour and
// none of the precedence logic below has to know which is in force.
//
// The whole eye stays EYE_W x EYE_H in every style so the pupil's safe travel
// is one calculation rather than five. Only three things vary: how much the
// corners are cut, how tall the eye is, and how big the pupil sits inside it.
const STYLE_ROUND = 0            // rounded rectangle -- the rover's own
const STYLE_CIRCLE = 1           // corners cut twice as deep, reads as round
const STYLE_ROBOT = 2            // hard corners, a wide letterbox pupil
const STYLE_BIG = 3              // round with a highlight, the cartoon one
const STYLE_VISOR = 4            // a short wide band, more helmet than eye
const FACE_STYLES = 5
let faceStyle = STYLE_ROUND

// Corner inset: how far the two crossed rectangles are pulled in from the
// edges. 0 leaves a hard rectangle, and bigger bites more off each corner.
function styleInset(): number {
    if (faceStyle == STYLE_ROBOT) return 0
    if (faceStyle == STYLE_CIRCLE) return 8
    if (faceStyle == STYLE_VISOR) return 4
    return 3
}

// Visor is a band rather than a full eye, so it is the one style whose height
// differs -- and its pupil shrinks to match, or it would punch straight
// through the top and bottom of a shorter eye.
function styleEyeH(): number {
    return faceStyle == STYLE_VISOR ? 24 : EYE_H
}

function stylePupW(): number {
    if (faceStyle == STYLE_VISOR) return 12
    if (faceStyle == STYLE_BIG) return 24
    if (faceStyle == STYLE_ROBOT) return 24
    return PUP
}

function stylePupH(): number {
    if (faceStyle == STYLE_VISOR) return 12
    if (faceStyle == STYLE_BIG) return 24
    if (faceStyle == STYLE_ROBOT) return 14      // letterbox, not square
    return PUP
}

// How far the pupils travel when the robot looks at something. NOT free to
// pick: the pupil is a hole punched in the eye, and past +/-9 horizontally
// it reaches the 3px rounded border and opens the eye into a C. Rendering
// the geometry is the only way this shows up — on hardware it just looks
// like a drawing bug. Same reason the dizzy roll below stays inside +/-6
// vertically rather than the 8 the arithmetic technically allows.
const GAZE = 8
// Vertical travel is tighter than horizontal: the pupil has less room above
// and below it than to either side, and 6 keeps a rim at full stretch.
const GAZE_Y = 6

// Screen modes. There is no RADAR here, unlike the rover: a sonar map needs a
// heading to plot each reading against, and this robot's ultrasonic is bolted
// to the chassis facing forward. Sweeping it would mean sweeping the whole
// robot, which is driving, not looking.
const SCREEN_STATUS = 0
const SCREEN_FACE = 1
const SCREEN_AUTO = 2            // status until connected, then the face
const SCREEN_RADAR = 3           // needs the sonar on Servo 1 -- see RADAR
const SCREEN_MODES = 4
let screenMode = SCREEN_STATUS

let faceNextBlinkAt = 0
let faceShutUntil = 0
let faceDizzyUntil = 0
let faceSpun = false
let faceHappyUntil = 0
// A quarter of blinks are winks. Same code path, one eye left open, and it
// buys more character per line than anything else the face does.
let faceWink = false
let faceWinkLeft = true
let faceSig = ""                 // last frame drawn, so a still face costs nothing

// The only question worth answering before a link exists is WHICH micro:bit
// this is — the browser's chooser lists these names and they all look alike,
// so a robot showing eyes instead is withholding the one fact you need.
function faceWanted(): boolean {
    if (screenMode == SCREEN_FACE) return true
    return screenMode == SCREEN_AUTO && btConnected
}

// cos 45 degrees. Comparing the gravity vector against its RESTING direction
// beats comparing pitch and roll against zero, twice over: it needs no idea
// which way the board is mounted, and it does not go unstable near vertical,
// where roll stops meaning anything at all.
const TILT_COS = 0.707

// LEARNED at power-up, never assumed. This micro:bit lies FLAT in the
// Maqueen's edge connector, where the rover's stands upright in a driver
// board — which is exactly why the resting attitude is measured rather than
// hardcoded. Get it wrong and the robot believes it is being held in the air
// permanently, wears the alarmed face forever, and hides every other
// expression behind it.
let restX = 0
let restY = 0
let restZ = 0

function attitudeCalibrate() {
    // Four samples: the accelerometer is noisy and this baseline is compared
    // against for the rest of the session.
    restX = 0; restY = 0; restZ = 0
    for (let i = 0; i < 4; i++) {
        restX += input.acceleration(Dimension.X)
        restY += input.acceleration(Dimension.Y)
        restZ += input.acceleration(Dimension.Z)
        basic.pause(20)
    }
    restX = Math.idiv(restX, 4)
    restY = Math.idiv(restY, 4)
    restZ = Math.idiv(restZ, 4)
    dbg("attitude: x=" + restX + " y=" + restY + " z=" + restZ)
}

// The angle between where gravity points NOW and where it pointed at boot.
function tilted(): boolean {
    const x = input.acceleration(Dimension.X)
    const y = input.acceleration(Dimension.Y)
    const z = input.acceleration(Dimension.Z)
    const magNow = Math.sqrt(x * x + y * y + z * z)
    const magRest = Math.sqrt(restX * restX + restY * restY + restZ * restZ)
    // In free fall, or before calibration, there is no direction to compare.
    if (magNow < 200 || magRest < 200) return false
    return (x * restX + y * restY + z * restZ) / (magNow * magRest) < TILT_COS
}

// cutRight says which side the brow wedge bites into: the OUTER edge of each
// eye, so the two are mirror images rather than parallel.
function drawEye(x: number, mode: number, dx: number, dy: number, cutRight: boolean) {
    if (mode == FACE_HAPPY) {
        // An arc with its middle riding UP, which is the shape a shut, smiling
        // eye makes. Drawn as one short vertical run per column: a curve is
        // the only thing on this screen that cannot be faked with rectangles,
        // and at five pixels thick it still reads as a line rather than a blob.
        for (let c = 0; c < EYE_W; c++) {
            // t runs -100..100 across the eye; t*t/100 is the parabola.
            const t = Math.idiv(c * 200, EYE_W - 1) - 100
            const rise = Math.idiv(HAPPY_DEPTH * (10000 - t * t), 10000)
            fbRect(x + c, EYE_Y + SMILE_Y - rise, 1, HAPPY_THICK, true)
        }
        return
    }
    const eh = styleEyeH()
    // Centre a short eye in the space a tall one would use, so switching style
    // does not shift the face up the glass.
    const y = EYE_Y + ((EYE_H - eh) >> 1)
    if (mode == FACE_SHUT) {
        // A bar, not a short rectangle: anything taller reads as a squint.
        fbRect(x, y + (eh >> 1) - 3, EYE_W, 6, true)
        return
    }
    const ins = styleInset()
    // Rounded with two crossed rectangles. Cheaper than a circle, and the
    // corners are the only part anyone notices at this size. An inset of 0
    // collapses both to the same rectangle, which is the robot style.
    fbRect(x + ins, y, EYE_W - ins * 2, eh, true)
    fbRect(x, y + ins, EYE_W, eh - ins * 2, true)
    // The pupil is a HOLE punched in the white of the eye. It shrinks when
    // the robot is lifted — a small pupil in a wide eye is what alarm looks
    // like, and it costs nothing but a smaller rectangle.
    const startled = mode == FACE_ALARM || mode == FACE_STARTLE
    const pw = startled ? PUP_SMALL : stylePupW()
    const ph = startled ? PUP_SMALL : stylePupH()
    const ox = (EYE_W - pw) >> 1
    const oy = (eh - ph) >> 1
    // CLAMP THE GAZE TO WHAT THIS STYLE CAN HOLD. The pupil is a hole, so one
    // that reaches the border opens the eye into a C -- and how much room
    // there is depends on the style's own pupil size, eye height and corner
    // inset. A single GAZE constant cannot be right for all five: a circular
    // eye has barely half the travel a hard rectangle does. Clamping against
    // the geometry here, rather than tuning five constants by eye, also means
    // a sixth style added later cannot reintroduce the bug.
    const rim = ins > 0 ? ins : 2
    const cdx = Math.constrain(dx, rim + 1 - ox, (EYE_W - rim - 1) - (ox + pw))
    const cdy = Math.constrain(dy, rim + 1 - oy, (eh - rim - 1) - (oy + ph))
    fbRect(x + ox + cdx, y + oy + cdy, pw, ph, false)
    // One lit square inside the hole, high and outward: the catchlight that
    // separates a cartoon eye from a hole cut in a mask. Only the BIG style
    // has a pupil with room for it.
    if (faceStyle == STYLE_BIG && !startled) {
        fbRect(x + ox + cdx + (cutRight ? pw - 9 : 4),
               y + oy + cdy + 4, 5, 5, true)
    }
    if (mode == FACE_WORRIED) {
        // Brows, as a wedge cleared off the top: deepest at the OUTER edge so
        // the inner ends ride UP. Cut them the other way and the same shape
        // reads as angry instead of worried. Just shortening the eye, which is
        // what this did first, only ever read as a squint.
        // Scaled to the style's own eye height, so a short visor gets a
        // shallow brow instead of having most of it cleared away.
        const brow = Math.idiv(BROW * eh, EYE_H)
        for (let c = 0; c < EYE_W; c++) {
            const t = cutRight ? c : (EYE_W - 1 - c)
            const d = Math.idiv(t * brow, EYE_W - 1)
            if (d > 0) fbRect(x + c, y, 1, d, false)
        }
    }
}

function faceRender(now: number) {
    // Frozen while the wheels turn. A frame is 1024 bytes on the same bus as
    // the motor driver, inside the loop that feeds the drive watchdog — and
    // nobody is watching the robot's eyes while it drives away from them.
    const driving = lastDriveL != 0 || lastDriveR != 0
    if (driving) {
        if ((lastDriveL > 0 && lastDriveR < 0) || (lastDriveL < 0 && lastDriveR > 0)) {
            faceSpun = true      // remember it, so the dizziness can land after
        }
        // v58 froze the face outright here. That was right for the rover,
        // whose eyes track a head that sweeps CONTINUOUSLY -- every tick a new
        // frame, forever, on the bus the servos need. A direction glance is
        // the opposite: it changes only when a button does, and faceSig drops
        // the frame when nothing changed. So the eyes may follow the driving
        // after all; the ration below is just a floor under a mashed D-pad.
        if (now < faceDriveNextAt) return
        faceDriveNextAt = now + FACE_DRIVE_MIN_MS
    }
    if (!driving && faceSpun) {
        faceSpun = false
        faceDizzyUntil = now + FACE_DIZZY_MS
    }
    // Setting off after a rest gets one blink -- noticing where it is going.
    if (driving && !faceWasDriving && now >= faceShutUntil) {
        faceShutUntil = now + FACE_BLINK_SHUT_MS
        faceWink = false
    }
    faceWasDriving = driving
    // The flinch is the CROSSING, not the condition.
    if (alertActive && !faceAlertSeen) faceStartleUntil = now + FACE_STARTLE_MS
    faceAlertSeen = alertActive

    let mode = FACE_OPEN
    let dx = 0
    let dy = 0
    // Happy outranks even being picked up. Touching the logo is the only
    // deliberate thing in this list — someone asked the robot for a face, and
    // the tilt from lifting it to reach the logo must not answer instead.
    if (now < faceHappyUntil) {
        mode = FACE_HAPPY
    } else if (tilted()) {
        mode = FACE_ALARM
        dy = 8                   // eyes down, at the floor going away
        // Safe at 8 only because the alarmed pupil is PUP_SMALL, not PUP.
    } else if (now < faceStartleUntil) {
        // Outranks dizzy and worried: something arrived in front of the robot
        // just now, and that is more urgent than how it feels about it.
        mode = FACE_STARTLE
        dy = -GAZE_Y             // eyes up and wide, away from the thing
    } else if (now < faceDizzyUntil) {
        mode = FACE_DIZZY
        const phase = Math.idiv(now, 120) % 4
        dx = phase == 0 ? -GAZE : (phase == 2 ? GAZE : 0)
        dy = phase == 1 ? -6 : (phase == 3 ? 6 : 0)
    } else if (lastDistShown >= 0 && lastDistShown < ALERT_CM) {
        mode = FACE_WORRIED
        dy = 3                   // pupils drop a little under the brows
    } else if (now - lastDriveCmdAt > FACE_SLEEP_MS) {
        mode = FACE_SHUT
    } else if (now >= faceNextBlinkAt) {
        faceShutUntil = now + FACE_BLINK_SHUT_MS
        faceNextBlinkAt = now + 2500 + Math.randomRange(0, 3500)
        faceWink = Math.randomRange(0, 3) == 0
        faceWinkLeft = Math.randomRange(0, 1) == 0
    }
    if (mode == FACE_OPEN) {
        if (now < faceShutUntil) mode = FACE_SHUT
        else if (btnFwd || btnBack || btnLeft || btnRight) {
            // Looking where it is going. Read from the button flags rather
            // than the motor values, so a diagonal shows as a diagonal instead
            // of arriving pre-mixed as two wheel speeds. The two axes are
            // independent here exactly as they are in the drive mix, so
            // up+right needs no case of its own.
            if (btnLeft && !btnRight) dx = -GAZE
            else if (btnRight && !btnLeft) dx = GAZE
            if (btnFwd && !btnBack) dy = -GAZE_Y
            else if (btnBack && !btnFwd) dy = GAZE_Y
        }
        // Parked, the eyes look at whichever line sensor is over the line. The
        // rover follows its sweep head here; this robot has no head, and the
        // line beneath it is the one thing it is actually looking at. Both
        // sensors, or neither, means straight ahead.
        else if (oledLineL == 1 && oledLineR == 0) dx = -GAZE
        else if (oledLineR == 1 && oledLineL == 0) dx = GAZE
    }

    // A wink is a SHUT frame that draws one eye open, so it has to be part of
    // the signature — otherwise it looks identical to a blink and the frame
    // is skipped as unchanged.
    const winking = mode == FACE_SHUT && faceWink
    const sig = "" + faceStyle + ":" + mode + "," + dx + "," + dy + (winking ? (faceWinkLeft ? ",wl" : ",wr") : "")
    if (sig == faceSig) return
    faceSig = sig
    fb.fill(0)
    drawEye(EYE_LX, winking && !faceWinkLeft ? FACE_OPEN : mode, dx, dy, false)
    drawEye(EYE_RX, winking && faceWinkLeft ? FACE_OPEN : mode, dx, dy, true)
    const t0 = input.runningTime()
    fbFlush()
    dbg("face frame " + (input.runningTime() - t0) + "ms mode=" + mode)
}

// What the app should show as "On screen". The status text is many lines and
// the face is not text at all, so this reports the one thing worth naming.
function oledCurrent(): string {
    if (screenMode == SCREEN_RADAR) return "Radar"
    if (faceWanted()) return "Face"
    if (oledText.length > 0) return oledText.substr(0, OLED_COLS)
    return "Status"
}

// Mode and glass state, pushed to the app. Called after anything that can
// change either, so the selector on screen and the button on the robot can
// never disagree about which is in force.
function screenReport() {
    const name = screenMode == SCREEN_FACE ? "Face"
        : screenMode == SCREEN_AUTO ? "Auto"
        : screenMode == SCREEN_RADAR ? "Radar" : "Status"
    sendUiValue("screen_mode", name)
    const cur = oledCurrent()
    if (cur != oledLastReported) {
        oledLastReported = cur
        sendUiValue("lbl_oled", cur)
    }
}

function oledRender() {
    if (!oledOk) return
    const now = input.runningTime()
    if (now < oledSplashUntil) return          // the splash owns the glass
    if (now < oledCheckAt) return
    oledCheckAt = now + OLED_REFRESH_MS
    // Rule 2. Parked is the only time this panel is worth any bus at all.
    if (lastDriveL != 0 || lastDriveR != 0) return
    // Read the patrol pins for the screen's own sake: the poll further down
    // runs only in Line/Avoid, so in Manual those values would be stale or
    // never set at all. readPatrol is a plain digital pin read, not I2C, so
    // this costs nothing on the bus we are protecting. The face reads these
    // too — they are what its eyes follow.
    oledLineL = maqueen.readPatrol(maqueen.Patrol.PatrolLeft) == 0 ? 1 : 0
    oledLineR = maqueen.readPatrol(maqueen.Patrol.PatrolRight) == 0 ? 1 : 0
    if (screenMode == SCREEN_RADAR && oledText.length == 0) {
        // Text and face must both repaint on the way back out.
        for (let i = 0; i < OLED_ROWS; i++) oledOnGlass[i] = ""
        faceSig = ""
        // Frozen while driving, like the face and for the same reason: a frame
        // is 1024 bytes on the bus the motors need. Worse here, since a sweep
        // taken while the robot turns plots readings against headings it has
        // already left.
        if (lastDriveL != 0 || lastDriveR != 0) return
        radarTick(now)
        // Redraw when a blip has aged out even if the beam has not moved, so
        // an abandoned picture fades instead of hanging there.
        if (radarFresh || now >= scopeExpireAt) {
            scopeExpireAt = now + 1000
            scopeBeamAt = headAngle
            scopeDraw(now)
            radarFresh = false
        }
        return
    }
    if (faceWanted()) {
        // Text must repaint when we come back, or half the old status would
        // survive underneath the next frame.
        for (let i = 0; i < OLED_ROWS; i++) oledOnGlass[i] = ""
        faceRender(now)
        return
    }
    faceSig = ""                 // and the face likewise, on the way back
    const want = oledLines()
    // Hard-clip rather than trust the builders above. One line over 21
    // characters wraps onto the next row and shoves the whole panel down by
    // one, which reads as a bug in whatever the last row was showing.
    for (let i = 0; i < OLED_ROWS; i++) {
        if (want[i].length > OLED_COLS) want[i] = want[i].substr(0, OLED_COLS)
    }
    let changed = false
    for (let i = 0; i < OLED_ROWS; i++) {
        if (want[i] != oledOnGlass[i]) changed = true
    }
    if (!changed) return                       // rule 3, the important one
    // Measured, not assumed: this is the number that decides whether the
    // interval above is affordable. Turn debug on to read it.
    const t0 = now
    OLED.clear()
    for (let i = 0; i < OLED_ROWS; i++) {
        OLED.writeStringNewLine(want[i])
        oledOnGlass[i] = want[i]
    }
    dbg("oled repaint " + (input.runningTime() - t0) + "ms")
}



function handleWidget(id: string, val: string) {
    // Every SET command lands here first — logged unconditionally so
    // you can see exactly what the app sent, even for widgets/ids the
    // handlers below don't recognize.
    dbg("recv: " + id + " = " + val)

    // Button: STOP — kill both motors immediately.
    if (id == "btn_stop" && val == "1") {
        maqueen.motorStop(maqueen.Motors.All)
        // Was basic.showIcon(IconNames.No) — blocking, and this runs
        // inside the BLE receive handler. Still shows the ✗, but via
        // the deferred renderer so nothing blocks here.
        lastDriveL = 0
        lastDriveR = 0
        // Otherwise a jog button still physically held would immediately
        // restart its wheel on the next applyJog().
        clearJog()
        requestStopIcon()
        dbg("stop button pressed")
    }

    // Buttons: per-wheel jog. M1 is the LEFT wheel and M2 the RIGHT — the same
    // assignment handleDpadMask() relies on, where a left turn drives M1
    // backward and M2 forward.
    if (id == "btn_ml" || id == "btn_mr") {
        if (id == "btn_ml") jogL = (val == "1")
        else jogR = (val == "1")
        applyJog()
        dbg("jog: L=" + (jogL ? 1 : 0) + " R=" + (jogR ? 1 : 0))
    }

    // Slider: Speed — top speed for BOTH manual and autonomous driving.
    if (id == "spd") {
        driveSpeed = Math.constrain(parseInt(val), DRIVE_SPEED_MIN, DRIVE_SPEED_MAX)
        uiGaugeSpdDirty = true
        uiGaugeLastInputAt = input.runningTime()
        requestGlyphValue(GLYPH_SERVO, Math.idiv(driveSpeed * 180, DRIVE_SPEED_MAX))
        dbg("speed -> " + driveSpeed)
    }

    // Select: Telemetry — how much the robot reports back.
    if (id == "upd") {
        if (val == "Off") updLevel = UPD_OFF
        else if (val == "Basic") updLevel = UPD_BASIC
        else updLevel = UPD_ALL
        // Re-announce the version on the way back up, since the label
        // would otherwise stay blank from whatever was missed while
        // silenced. Cheap, and it confirms the setting took effect.
        if (updLevel != UPD_OFF) versionSent = false
        dbg("telemetry -> " + val)
    }

    // Select: Distance read — Auto / Read now.
    //
    // "Read now" is intentionally a ONE-SHOT override. It may be used in
    // Manual, Line or Avoid without enabling continuous ultrasonic polling.
    // That preserves the low-latency lesson from v43: a no-echo HC-SR04 read
    // can busy-wait for ~250 ms, so polling it continuously in Manual/Line
    // makes motor control feel laggy. The forever loop performs the actual
    // measurement (never this BLE callback), updates gauge + graph, then
    // publishes UPD dist_read Auto so compatible clients reset the selector.
    if (id == "dist_read" && val == "Read now") {
        forceDistanceOnce = true
        dbg("distance: forced one-shot requested")
    }

    // Select: Screen — Status / Face / Auto. The same three the button on the
    // robot cycles, so either can drive it and both stay in step.
    if (id == "screen_mode") {
        const wasRadar = screenMode == SCREEN_RADAR
        if (val == "Face") screenMode = SCREEN_FACE
        else if (val == "Auto") screenMode = SCREEN_AUTO
        else if (val == "Radar") screenMode = SCREEN_RADAR
        else screenMode = SCREEN_STATUS
        // Same handover as button A: a sweep leaves the horn wherever it
        // happened to stop, and the app's slider would silently disagree.
        if (wasRadar && screenMode != SCREEN_RADAR) {
            maqueen.servoRun(maqueen.Servos.S1, uiServo1)
        }
        radarFresh = true
        // Force whichever renderer comes next to repaint over the other one.
        faceSig = ""
        for (let i = 0; i < OLED_ROWS; i++) oledOnGlass[i] = ""
        screenReport()
        dbg("screen -> " + val)
        return
    }

    // Select: Face style — five looks, one mood system.
    // Select: Radar head — Sweep pans on its own, Aim follows Servo 1.
    if (id == "head_mode") {
        radarSweep = (val == "Sweep")
        // Leaving Sweep hands the horn back where the slider thinks it is, so
        // the two never disagree about which way the robot is looking.
        if (!radarSweep) maqueen.servoRun(maqueen.Servos.S1, uiServo1)
        radarFresh = true
        dbg("radar head -> " + val)
        return
    }

    if (id == "face_style") {
        if (val == "Circle") faceStyle = STYLE_CIRCLE
        else if (val == "Robot") faceStyle = STYLE_ROBOT
        else if (val == "Big") faceStyle = STYLE_BIG
        else if (val == "Visor") faceStyle = STYLE_VISOR
        else faceStyle = STYLE_ROUND
        faceSig = ""             // the style is in the signature; force a frame
        dbg("face style -> " + val)
        return
    }

    // A message typed in the app, shown on the robot's own screen. Clearing
    // the field hands the top rows back to the status text.
    if (id == "oled_text") {
        oledText = val
        faceSig = ""
        for (let i = 0; i < OLED_ROWS; i++) oledOnGlass[i] = ""
        screenReport()
        dbg("screen text -> " + oledCurrent())
        return
    }

    // Select: Mode — Manual / Line / Avoid.
    if (id == "mode") {
        // Always stop first. Switching mode while the wheels are turning
        // would otherwise carry the old command into the new mode.
        maqueen.motorStop(maqueen.Motors.All)
        lastDriveL = 0
        lastDriveR = 0
        btnFwd = false
        btnBack = false
        btnLeft = false
        btnRight = false
        // Same reason as the D-pad flags above: a jog button held across a mode
        // switch must not be treated as still pressed when Manual comes back.
        clearJog()
        avoidPhase = 0
        avoidUntil = 0
        if (val == "Line") driveMode = MODE_LINE
        else if (val == "Avoid") driveMode = MODE_AVOID
        else driveMode = MODE_MANUAL
        // Reset ownership timing at the mode boundary. The age of the last
        // Manual D-pad packet must never decide whether autonomous motors run.
        lastDriveCmdAt = input.runningTime()
        requestDriveDebug(0, 0)
        dbg("mode -> " + val)
    }

    // Button: Buzz — short confirmation beep.
    if (id == "btn_buzz" && val == "1") {
        requestGlyph(GLYPH_BUZZ)
        music.playTone(440, music.beat(BeatFraction.Quarter))
    }

    // Slider: Servo 1 / Servo 2 — widget's min/max (0-180) already match
    // maqueen.servoRun's angle range, so val is a direct degree value.
    // Same rate-limit/change-detection guard as driveMix(): dragging a
    // slider fires many rapid SET messages, and unthrottled servoRun()
    // calls at that frequency can lock up the I2C bus hard enough to
    // freeze the WHOLE firmware (confirmed: the heartbeat, which never
    // touches I2C, stopped incrementing the moment Servo 1 was dragged).
    if (id == "slider_srv1") {
        let angle1 = Math.constrain(parseInt(val), 0, 180)
        uiServo1 = angle1
        uiGaugeSrv1Dirty = true
        uiGaugeLastInputAt = input.runningTime()
        // Glyph updates on EVERY message, outside the rate-limit gate:
        // the guard exists to protect the I2C bus, not the display, and
        // suppressing feedback while dragging would look like a dropped
        // command. Drawing is deferred to the loop, so it is cheap.
        requestGlyphValue(GLYPH_SERVO, angle1)
        if (servoWriteAllowed(1, angle1)) {
            maqueen.servoRun(maqueen.Servos.S1, angle1)
            dbg("servo S1 -> " + angle1)
        }
    }
    if (id == "slider_srv2") {
        let angle2 = Math.constrain(parseInt(val), 0, 180)
        uiServo2 = angle2
        uiGaugeSrv2Dirty = true
        uiGaugeLastInputAt = input.runningTime()
        requestGlyphValue(GLYPH_SERVO, angle2)
        if (servoWriteAllowed(2, angle2)) {
            maqueen.servoRun(maqueen.Servos.S2, angle2)
            dbg("servo S2 -> " + angle2)
        }
    }

    // Toggle: LED L / LED R
    if (id == "toggle_led_l") {
        requestGlyphValue(GLYPH_LED_L, val == "1" ? 1 : 0)
        maqueen.writeLED(maqueen.LED.LEDLeft, val == "1" ? maqueen.LEDswitch.turnOn : maqueen.LEDswitch.turnOff)
    }
    if (id == "toggle_led_r") {
        requestGlyphValue(GLYPH_LED_R, val == "1" ? 1 : 0)
        maqueen.writeLED(maqueen.LED.LEDRight, val == "1" ? maqueen.LEDswitch.turnOn : maqueen.LEDswitch.turnOff)
    }

    // D-pad: Drive (val = "<dir> <1|0>", dir = up/down/left/right).
    // All 4 directions share this ONE widget id — see the header
    // comment on the app-side reliable-send fix (sendReliable() /
    // bleSend.queue) that makes this safe. Each direction just sets
    // its own boolean; multiple can be held at once for a diagonal,
    // same as the earlier 4-separate-buttons approach.
    if (id == "dpad_move") {
        // Ignored while an autonomous mode owns the motors — otherwise a
        // stray press would fight the behaviour for control of the same
        // two wheels. Switch the Mode selector back to Manual to drive.
        if (driveMode != MODE_MANUAL) {
            dbg("dpad ignored (mode " + driveMode + ")")
            return
        }
        lastDriveCmdAt = input.runningTime()
        let parts = val.split(" ")
        let dir = parts[0]
        let pressed = parts[1] == "1"
        if (dir == "up") btnFwd = pressed
        else if (dir == "down") btnBack = pressed
        else if (dir == "left") btnLeft = pressed
        else if (dir == "right") btnRight = pressed
        dbg("dpad: " + dir + " = " + pressed)
        updateButtonDrive()
    }
}

// ═══════════════════════════════════════════════════════════════
// 📤 SEND VALUES TO APP (optional — none of this layout's widgets
// are output widgets, but sendValue() is here if you add a gauge,
// label or LED-output widget later, e.g. to show DIST:cm)
// ═══════════════════════════════════════════════════════════════

function sendValue(id: string, val: string) {
    // btConnected as well as cfgSent — see the flag's declaration for
    // why writing to a dead UART is not merely wasteful but blocking.
    if (!btConnected || !cfgSent) return
    if (updLevel == UPD_OFF) return
    // Basic keeps the uptime clock and the version label — the two that
    // answer "is it alive?" and "what is flashed?" — and drops the rest.
    if (updLevel == UPD_BASIC && id != "lbl_heartbeat" && id != "lbl_ver") return
    bluetooth.uartWriteLine("UPD " + id + " " + val)
}

// ═══════════════════════════════════════════════════════════════
// 🚀 STARTUP
// ═══════════════════════════════════════════════════════════════

// Safety: stop any leftover motion and center servos on boot.
maqueen.motorStop(maqueen.Motors.All)
maqueen.servoRun(maqueen.Servos.S1, 90)
maqueen.servoRun(maqueen.Servos.S2, 90)

// THE SCREEN COMES UP FIRST, and the order here is the whole reason it is
// quick. Until v60 basic.showString() ran ahead of oledInit(): it scrolls the
// version across the 5x5 matrix a column at a time and BLOCKS for roughly two
// seconds doing it, so the panel sat dark through all of it and the robot
// looked dead until the self-test finally appeared. Nothing was slow about
// the screen; it was simply last in the queue.
oledInit()
fbInit()
oledSelfTest()

// Now the blocking parts, with the self-test already readable while they run.
// The LED scroll is still worth having -- it is the only version readout on a
// robot with no screen fitted -- but at 80ms per column instead of the 150ms
// default, since the OLED is now carrying the same number anyway.
basic.showString(FIRMWARE_VERSION, 80)
// Measured while the robot is sitting still on the bench, which is the only
// moment its resting attitude is known for certain.
attitudeCalibrate()
// Idle indicator: a hollow ring, held until BLE connects. Deliberately
// not a filled shape — ■ already means "STOP pressed" and the centre dot
// means "motors idle", so a solid glyph here would be confusable. The
// ring reads as "powered, waiting", and it must be visibly different
// from a blank screen, otherwise a booted-but-unconnected robot looks
// indistinguishable from a flat battery.
basic.showLeds(`
    . # # # .
    # . . . #
    # . . . #
    # . . . #
    . # # # .
    `, 0)
// Start the self-test's clock HERE rather than inside oledSelfTest(). Drawn
// early on purpose, it would otherwise spend most of its hold behind the LED
// scroll and the accelerometer sampling, and be replaced by the status screen
// a moment after those finished -- readable for a fraction of the time it
// looked like it was being given.
oledSplashUntil = input.runningTime() + OLED_SPLASH_MS

// Button A cycles the screen. Deliberately a button on the robot rather than
// a widget in the app: the face is for whoever is in the room with it, and
// this way it costs neither a layout change nor the hidden `settings`
// extension the rover needs to remember its choice across a power cycle.
input.onButtonPressed(Button.A, function () {
    if (!oledOk) return
    const was = screenMode
    screenMode = (screenMode + 1) % SCREEN_MODES
    // Servo 1 is the sweep head while the radar is up. Stepping off that
    // screen has to hand it back, or it stops wherever the sweep happened to
    // leave it and the app's slider silently disagrees with the horn.
    if (was == SCREEN_RADAR) maqueen.servoRun(maqueen.Servos.S1, uiServo1)
    radarFresh = true
    // Force whichever renderer comes next to repaint over the other one.
    for (let i = 0; i < OLED_ROWS; i++) oledOnGlass[i] = ""
    faceSig = ""
    screenReport()
    dbg("screen mode -> " + screenMode)
})

// Button B cycles the face style, so the look can be changed with no app
// attached -- the same reason button A cycles the screen.
input.onButtonPressed(Button.B, function () {
    if (!oledOk) return
    faceStyle = (faceStyle + 1) % FACE_STYLES
    faceSig = ""
    sendUiValue("face_style", faceStyle == STYLE_CIRCLE ? "Circle"
        : faceStyle == STYLE_ROBOT ? "Robot"
        : faceStyle == STYLE_BIG ? "Big"
        : faceStyle == STYLE_VISOR ? "Visor" : "Round")
    dbg("face style -> " + faceStyle)
})

// The one deliberate request for a face in the whole firmware, so it outranks
// every mood the robot works out for itself. V2 only; on a V1 this simply
// never fires and nothing else changes.
input.onLogoEvent(TouchButtonEvent.Pressed, function () {
    faceHappyUntil = input.runningTime() + HAPPY_MS
})

dbg("Maqueen Remote firmware " + FIRMWARE_VERSION + " ready, waiting for BLE connection...")

bluetooth.onBluetoothConnected(function () {
    btConnected = true
    dbg("BLE connected")
})

// Safety: kill motors when the link goes away, so the robot does not
// keep driving on the last command it received.
//
// Called from TWO places: the BLE disconnect event (which does not fire
// on this board, but costs nothing to keep wired up in case another one
// behaves) and the silence timeout in the forever loop, which is what
// actually catches it here. Idempotent — whichever arrives first wins.
function handleLinkLost() {
    if (linkLostHandled) return
    linkLostHandled = true
    // Before anything else: a jog button held when the link died must not
    // survive into the next connection, and its wheel must not keep turning.
    clearJog()
    // FIRST: stop anything else from touching the radio. Every write
    // after this point would block on a dead link and wedge the BLE
    // stack, which is what made the next connect hang in service
    // discovery. Also drop any queued log lines — they are addressed to
    // a peer that is gone.
    btConnected = false
    cfgSent = false
    cfgTxActive = false
    cfgTxStage = 0
    cfgTxPos = 0
    cfgTxChunkIdx = 0
    cfgVerPending = false
    cfgVerReplyAt = 0
    uiInitialSyncStage = 0
    uiGaugeSrv1Dirty = false
    uiGaugeSrv2Dirty = false
    uiGaugeSpdDirty = false
    uiGaugeTxNextAt = 0
    logQueue = []
    // v46: reboot the BLE peripheral after the X is painted. This is the
    // automatic replacement for the physical RESET that was previously
    // required before GETCFG would work after a disconnect.
    bleStackResetAt = input.runningTime() + BLE_STACK_RESET_DELAY_MS
    maqueen.motorStop(maqueen.Motors.All)
    // Clear the drive state too, not just the motors. Otherwise, if the
    // link dropped mid-drive, lastDriveL/R stay non-zero and the loop's
    // watchdog fires ~700ms later, calling requestDriveDebug(0,0) and
    // repainting the centre dot straight over the ✗ — so a disconnect
    // that happened while moving looked like an ordinary stop.
    lastDriveL = 0
    lastDriveR = 0
    lastDriveCmdAt = input.runningTime()
    btnFwd = false
    btnBack = false
    btnLeft = false
    btnRight = false
    // Reset the drive glyph state, then request ✗ through the single
    // renderer below so nothing can overwrite it.
    pendingDebugL = 0
    pendingDebugR = 0
    requestGlyph(GLYPH_DISCONNECTED)
    // Heartbeat restarts per session, so the clock reads session uptime
    // rather than time since power-on.
    heartbeat = 0
    // Force the next line readings to be transmitted even if they match
    // the last ones from the previous session — otherwise the line LEDs
    // sit blank until something happens to change. (The graph is not
    // deduped at all, so it needs no reset.)
    lastLineL = -1
    lastLineR = -1
    alertActive = false
    // Re-announce the version on the next connect; the app rebuilds its
    // widgets from scratch each session, so the label would be blank.
    versionSent = false
    // Drop out of any autonomous mode. The loop already stops running
    // behaviours once btConnected goes false, but resetting here means a
    // reconnect starts in a known, stationary state rather than silently
    // resuming Line or Avoid the moment the link returns.
    driveMode = MODE_MANUAL
    avoidPhase = 0
    avoidUntil = 0
    dbg("link lost, motors stopped")
}

// Kept wired up even though it does not fire on this board — it costs
// nothing, and handleLinkLost() is idempotent so it cannot double-run
// with the silence timeout.
bluetooth.onBluetoothDisconnected(function () {
    dbg("BLE disconnect event")
    handleLinkLost()
    // If the main loop is ever stuck in a UART write, reset from this event
    // fiber anyway. X remains visible briefly, then Bluetooth starts clean.
    basic.pause(BLE_STACK_RESET_DELAY_MS)
    control.reset()
})

// ═══════════════════════════════════════════════════════════════
// 💓 HEARTBEAT — proves the firmware loop AND the BLE link are both
// genuinely alive, independent of pressing any button. Uses the same
// sendValue()/"UPD id val" mechanism the app already understands (see
// script.js's processLine handling of "UPD " lines) — NOT a bare
// bluetooth.uartWriteLine() call from inside a receive handler, which
// is exactly what broke everything in the v5 attempt. This only ever
// fires from the main forever loop, never from inside
// onUartDataReceived, so there's no receive/send conflict.
// ═══════════════════════════════════════════════════════════════

// 1s tick, reported as an uptime clock ("0d 00:01:05") rather than a
// raw count — it reads as session duration at a glance instead of a
// number you have to divide.
const HEARTBEAT_INTERVAL_MS = 1000
let nextHeartbeatAt = 0

// Zero-pad to two digits so the clock columns stay aligned.
function pad2(n: number): string {
    return n < 10 ? "0" + n : "" + n
}
// heartbeat counts seconds since the session started, so it doubles as
// the uptime source. Math.idiv is integer division — plain / would give
// a float and print "0.0166d".
//
// Leading all-zero units are omitted, so the display stays as short as
// the elapsed time actually requires and each unit only appears once it
// means something:
//        7s -> "07"
//       65s -> "01:05"
//     3661s -> "01:01:01"
//    90061s -> "1d 01:01:01"
// Padding is kept on the units that DO show, so the digits stay aligned
// and the value does not jitter in width every second.
function uptimeString(totalSec: number): string {
    let d = Math.idiv(totalSec, 86400)
    let h = Math.idiv(totalSec % 86400, 3600)
    let m = Math.idiv(totalSec % 3600, 60)
    let s = totalSec % 60
    if (d > 0) return d + "d " + pad2(h) + ":" + pad2(m) + ":" + pad2(s)
    if (h > 0) return pad2(h) + ":" + pad2(m) + ":" + pad2(s)
    if (m > 0) return pad2(m) + ":" + pad2(s)
    return pad2(s)
}
// Ultrasonic polling cadence.
//
// maqueen.Ultrasonic() is the most expensive call in this firmware, and
// its cost depends entirely on whether an echo comes back. From the
// library source, one readUlt() is basic.pause(1) + basic.pause(20) +
// pins.pulseIn(..., 500*58) — a 29ms timeout. An echo returns almost at
// once; no echo waits the timeout out, and Ultrasonic() then retries up
// to four more times. So a working sensor at ~30cm costs ~25ms, while a
// disconnected or out-of-range one costs ~250ms — and pulseIn BUSY-WAITS
// without yielding, freezing the whole runtime rather than just this
// loop. Polling this carelessly is what made the robot feel frozen.
//
// Two mitigations, both still earning their place:
//   1. Skipped while the wheels are turning (except in Avoid, where the
//      distance IS the input). A stall nobody notices while parked is
//      ruinous mid-drive.
//   2. Adaptive backoff — brisk while real distances come back, doubling
//      to DIST_INTERVAL_MAX_MS while the sensor reports nothing. The
//      expensive case is exactly the uninformative one.
const DIST_INTERVAL_MS = 400          // when the sensor is returning real distances
const DIST_INTERVAL_MAX_MS = 5000     // when it keeps reporting "no echo"
let distInterval = DIST_INTERVAL_MS
let nextDistAt = 0
let forceDistanceOnce = false   // v49: selector-triggered one-shot in ANY mode
let nextLineAt = 0
basic.forever(function () {
    let now = input.runningTime()

    // Drive watchdog runs every 100ms (finer than the 1s heartbeat
    // cadence below) so a stalled/dropped "stop" packet gets caught
    // within DRIVE_WATCHDOG_MS instead of up to a full second late.
    // Manual safety watchdog only. v43 accidentally supervised Line/Avoid
    // with the D-pad keepalive timeout too. Avoid can legitimately spend
    // longer than that between ultrasonic polls after no-echo backoff.
    // A held jog button sends ONE packet on press and nothing again until
    // release, unlike the D-pad which re-sends its mask about once a second.
    // Without this refresh the watchdog below would cut the wheel after
    // DRIVE_WATCHDOG_MS while the button is still physically down. The safety
    // net for a jog is therefore not this watchdog but the link timeout and
    // the disconnect handler, both of which call clearJog().
    // Gated on recent traffic, not merely on "not yet declared dead". The app
    // pings every 3s, so while the peer is alive lastRxAt keeps moving and the
    // refresh continues. If the link dies, lastRxAt goes stale, this stops
    // refreshing, and the watchdog below stops the wheel DRIVE_WATCHDOG_MS
    // later -- the same 2.5s the D-pad gets, rather than waiting out the 9s
    // LINK_TIMEOUT_MS.
    if ((jogL || jogR) && driveMode == MODE_MANUAL && !linkLostHandled
        && (now - lastRxAt) < DRIVE_WATCHDOG_MS) {
        lastDriveCmdAt = now
    }

    if (driveMode == MODE_MANUAL && (lastDriveL != 0 || lastDriveR != 0) && now - lastDriveCmdAt > DRIVE_WATCHDOG_MS) {
        maqueen.motorStop(maqueen.Motors.All)
        dbg("watchdog: no drive update for " + DRIVE_WATCHDOG_MS + "ms, auto-stop")
        requestDriveDebug(0, 0)
        lastDriveL = 0
        lastDriveR = 0
    }

    // ── DISPLAY FIRST, RADIO LAST ────────────────────────────────
    // Order is load-bearing, not cosmetic. bluetooth.uartWriteLine()
    // BLOCKS the calling fiber when the link is down or its buffer
    // cannot drain — the same landmine as serial.writeLine(). The two
    // writes below used to run BEFORE this render block, so at the
    // moment of a disconnect the loop would block inside a write that
    // never completes, and since this loop is the only thing that draws
    // the LED matrix, the ✗ was never painted. Drawing first means a
    // wedged radio can no longer starve the display.
    if (debugDirty) {
        debugDirty = false
        if (pendingGlyph == GLYPH_STOP) {
            // Square = "stop" (like a stop button). Deliberately NOT
            // IconNames.No — that ✗ means "BLE disconnected", and the
            // two must stay visually distinct. Also distinct from
            // showDriveDebug's centre dot (motors idle) and
            // SmallDiamond (one wheel only).
            basic.showIcon(IconNames.Square, 0)
        } else if (pendingGlyph == GLYPH_DISCONNECTED) {
            basic.showIcon(IconNames.No, 0)
        } else if (pendingGlyph == GLYPH_CONNECTED) {
            basic.showIcon(IconNames.Yes, 0)
        } else if (pendingGlyph == GLYPH_LED_L) {
            // Left band solid when that LED is on, just its corners when
            // off — so the side tells you WHICH led and the fill tells
            // you its state, readable at a glance from across the table.
            if (pendingValue == 1) {
                basic.showLeds(`
                    # # . . .
                    # # . . .
                    # # . . .
                    # # . . .
                    # # . . .
                    `, 0)
            } else {
                basic.showLeds(`
                    # . . . .
                    . . . . .
                    . . . . .
                    . . . . .
                    # . . . .
                    `, 0)
            }
        } else if (pendingGlyph == GLYPH_LED_R) {
            if (pendingValue == 1) {
                basic.showLeds(`
                    . . . # #
                    . . . # #
                    . . . # #
                    . . . # #
                    . . . # #
                    `, 0)
            } else {
                basic.showLeds(`
                    . . . . #
                    . . . . .
                    . . . . .
                    . . . . .
                    . . . . #
                    `, 0)
            }
        } else if (pendingGlyph == GLYPH_BUZZ) {
            basic.showIcon(IconNames.QuarterNote, 0)
        } else if (pendingGlyph == GLYPH_SERVO) {
            // Bar graph scaled 0-180 — shows the angle as a magnitude
            // rather than a number, and unlike showNumber() it never
            // scrolls (scrolling would block this loop for seconds).
            led.plotBarGraph(pendingValue, 180)
        } else {
            showDriveDebug(pendingDebugL, pendingDebugR)
        }
    }

    // The OLED renders here for the same reason the LED matrix does: this is
    // the one place that is neither the BLE receive path nor a blocking
    // radio write. It self-gates on interval, motion and change.
    oledRender()

    // ── LINK LOSS BY SILENCE ─────────────────────────────────────
    // The real disconnect detector on this board, since the BLE event
    // never fires. The app pings once a second, so silence past
    // LINK_TIMEOUT_MS means the peer is gone — a closed tab, a reload,
    // a crashed browser, or simply walking out of range. Checked BEFORE
    // the radio gate below, because btConnected is set by an event that
    // is exactly the thing we cannot trust here.
    // ── BLE STACK RECOVERY (v46) ────────────────────────────────
    // The disconnect event resets from its own fiber too, but the silence
    // detector uses this path when the platform callback is missed.
    if (bleStackResetAt > 0 && now >= bleStackResetAt) {
        control.reset()
        return
    }

    // ── CONFIG REVISION REPLY (v47) ─────────────────────────────
    // This one short notification is the normal reconnect path. If the
    // browser already cached this revision it answers CFGOK and the robot is
    // ready immediately; otherwise it asks for the full transfer below.
    if (btConnected && cfgVerPending && now >= cfgVerReplyAt) {
        bluetooth.uartWriteLine("CFGVER " + CFG_REV)
        cfgVerPending = false
        basic.pause(20)
        return
    }

    // ── CONFIG TX STATE MACHINE (v46) ───────────────────────────
    // Never stream the whole layout from onUartDataReceived(). Sending one
    // notification per pass keeps RX and TX decoupled and lets disconnect
    // handling run between chunks.
    if (btConnected && cfgTxActive) {
        if (now >= cfgTxNextAt) {
            if (cfgTxStage == 0) {
                // Announce how many chunks are coming. The app matches this
                // line with startsWith(), so a client that ignores the argument
                // is unaffected -- but one that reads it can show a truthful
                // progress bar instead of guessing. The same total is already
                // computed below for the LED sweep.
                bluetooth.uartWriteLine("CFGBEGIN " + Math.idiv(CFG.length + 17, 18))
                cfgTxStage = 1
                cfgTxNextAt = now + CFG_TX_GAP_MS
            } else if (cfgTxStage == 1) {
                if (cfgTxPos < CFG.length) {
                    bluetooth.uartWriteLine("CFG " + CFG.substr(cfgTxPos, 18))
                    cfgTxPos += 18
                    cfgTxChunkIdx += 1
                    let totalChunks = Math.idiv(CFG.length + 17, 18)
                    let target = Math.idiv(cfgTxChunkIdx * 25, totalChunks)
                    while (cfgTxLit < target) {
                        led.plot(cfgTxLit % 5, Math.idiv(cfgTxLit, 5))
                        cfgTxLit += 1
                    }
                    cfgTxNextAt = now + CFG_TX_GAP_MS
                } else {
                    cfgTxStage = 2
                }
            } else {
                bluetooth.uartWriteLine("CFGEND")
                cfgTxActive = false
                cfgSent = true
                scheduleInitialUiSync()
                requestGlyph(GLYPH_CONNECTED)
                dbg("layout sent, cfgSent = true")
            }
        }
        // Keep the transfer loop tighter than the normal 100 ms control loop,
        // and do not mix heartbeat/sensor/log notifications into CFG traffic.
        basic.pause(20)
        return
    }

    if (cfgSent && !linkLostHandled && now - lastRxAt > LINK_TIMEOUT_MS) {
        handleLinkLost()
    }

    // Everything below talks to the radio, so it is all gated on
    // btConnected — set by the connect/disconnect events rather than
    // inferred from cfgSent. Writing to a dead UART is what wedges the
    // BLE stack, and a wedged stack is why getPrimaryService() hung
    // forever on the next connect attempt.
    if (!btConnected) {
        basic.pause(100)
        return
    }


    // ── CONFIG-NATIVE CONTROL GAUGES (v48) ───────────────────────
    // First publish the true boot/control values for both sliders and
    // gauges. After that, publish only a coalesced gauge update when a
    // slider has been quiet for a moment. A client that understands the
    // CFG `source` field mirrors instantly with zero BLE; older clients
    // still receive the firmware UPD shortly after the drag settles.
    if (cfgSent && now >= uiGaugeTxNextAt) {
        let uiSent = false
        if (uiInitialSyncStage > 0) {
            if (uiInitialSyncStage == 1) sendUiValue("slider_srv1", "" + uiServo1)
            else if (uiInitialSyncStage == 2) sendUiValue("gauge_srv1", "" + uiServo1)
            else if (uiInitialSyncStage == 3) sendUiValue("slider_srv2", "" + uiServo2)
            else if (uiInitialSyncStage == 4) sendUiValue("gauge_srv2", "" + uiServo2)
            else if (uiInitialSyncStage == 5) sendUiValue("spd", "" + driveSpeed)
            else if (uiInitialSyncStage == 6) sendUiValue("gauge_spd", "" + driveSpeed)
            // The robot may already be in Face — button A works with no app
            // attached — so the selector has to be told, not assumed to be
            // Status. Same for whatever is currently on the glass.
            else if (uiInitialSyncStage == 7) sendUiValue("screen_mode",
                screenMode == SCREEN_FACE ? "Face"
                    : screenMode == SCREEN_AUTO ? "Auto"
                    : screenMode == SCREEN_RADAR ? "Radar" : "Status")
            else if (uiInitialSyncStage == 8) sendUiValue("lbl_oled", oledCurrent())
            uiInitialSyncStage += 1
            if (uiInitialSyncStage > 8) uiInitialSyncStage = 0
            uiGaugeTxNextAt = now + UI_GAUGE_TX_GAP_MS
            uiSent = true
        } else if (now - uiGaugeLastInputAt >= UI_GAUGE_SETTLE_MS) {
            if (uiGaugeSrv1Dirty) {
                sendUiValue("gauge_srv1", "" + uiServo1)
                uiGaugeSrv1Dirty = false
                uiSent = true
            } else if (uiGaugeSrv2Dirty) {
                sendUiValue("gauge_srv2", "" + uiServo2)
                uiGaugeSrv2Dirty = false
                uiSent = true
            } else if (uiGaugeSpdDirty) {
                sendUiValue("gauge_spd", "" + driveSpeed)
                uiGaugeSpdDirty = false
                uiSent = true
            }
            if (uiSent) uiGaugeTxNextAt = now + UI_GAUGE_TX_GAP_MS
        }
        if (uiSent) {
            basic.pause(20)
            return
        }
    }

    // Scheduled off runningTime(), NOT by accumulating an assumed
    // 100ms per iteration. Each pass is pause(100) PLUS however long
    // the work took, so the old counter drifted slow exactly when the
    // firmware was busy — the heartbeat under-reported trouble at the
    // precise moment it was supposed to reveal it.
    if (now >= nextHeartbeatAt) {
        nextHeartbeatAt = now + HEARTBEAT_INTERVAL_MS
        if (cfgSent) {
            heartbeat += 1
            // v50: heartbeat visibility follows the Telemetry selector, not
            // the drive mode. sendValue() already enforces the policy:
            //   All/Basic -> heartbeat is transmitted
            //   Off       -> heartbeat is silent
            // Do not suppress heartbeat merely because Line/Avoid motors
            // are moving; autonomous drive is local to the micro:bit and
            // should not make the connection appear frozen.
            sendValue("lbl_heartbeat", uptimeString(heartbeat))
        }
    }

    // Firmware version, pushed once per session on the first tick after
    // the layout is delivered. Same value the LED matrix scrolls at
    // boot, but readable in the app — so "which build is actually on
    // this robot?" can be answered without watching the matrix or
    // plugging in USB. That question cost real time more than once.
    if (cfgSent && !versionSent) {
        versionSent = true
        if ((lastDriveL == 0 && lastDriveR == 0) || now - lastDriveCmdAt > 500) sendValue("lbl_ver", FIRMWARE_VERSION)
    }

    // ── Line sensors ─────────────────────────────────────────────
    // Polled every 100ms and pushed to the two LED widgets on CHANGE
    // only. readPatrol is a plain digital pin read — no echo wait, so
    // unlike the ultrasonic it costs nothing to poll often.
    if (driveMode != MODE_MANUAL && now >= nextLineAt) {
        nextLineAt = now + LINE_INTERVAL_MS
        let rawL = maqueen.readPatrol(maqueen.Patrol.PatrolLeft)
        let rawR = maqueen.readPatrol(maqueen.Patrol.PatrolRight)
        // Invert: 0 from the sensor means ON the black line, and a lit
        // LED should mean "on the line". See the comment at lastLineL.
        let onL = rawL == 0 ? 1 : 0
        let onR = rawR == 0 ? 1 : 0
        if (cfgSent && onL != lastLineL) {
            lastLineL = onL
            if ((lastDriveL == 0 && lastDriveR == 0) || driveMode != MODE_MANUAL) sendValue("ln_l", "" + onL)
        }
        if (cfgSent && onR != lastLineR) {
            lastLineR = onR
            if ((lastDriveL == 0 && lastDriveR == 0) || driveMode != MODE_MANUAL) sendValue("ln_r", "" + onR)
        }

        // Line-following: steer toward whichever side has left the line.
        if (driveMode == MODE_LINE) {
            if (onL == 1 && onR == 1) {
                driveAuto(0, 1)          // both on the line -> straight
            } else if (onL == 1 && onR == 0) {
                driveAuto(-0.6, 0.4)     // drifted right -> bear left
            } else if (onL == 0 && onR == 1) {
                driveAuto(0.6, 0.4)      // drifted left -> bear right
            } else {
                // Both off the line. Pivot in place to hunt for it again
                // rather than driving on blind.
                driveAuto(0.8, 0)
            }
            lastDriveCmdAt = now        // keep the watchdog satisfied
        }
    }

    // ── Ultrasonic (HC-SR04) — AVOID MODE ONLY ───────────────────
    //
    // This sensor is expensive enough to define the feel of the whole
    // robot. Measured from the pxt-maqueen source, one readUlt() is
    // basic.pause(1) + basic.pause(20) + pins.pulseIn(..., 500*58) — a
    // 29ms timeout, so ~50ms per attempt. With no echo Ultrasonic()
    // retries up to four more times: ~250ms per call. pulseIn BUSY-WAITS
    // without yielding, so that is a hard freeze of the entire runtime,
    // not merely of this loop.
    //
    // "No echo" is the normal state for a robot pointing at open space,
    // so it hit that worst case almost every poll. Polling it
    // continuously to feed a gauge and a graph cost roughly 83% of the
    // robot's life at the original 300ms interval, and the symptom was
    // exactly what you would expect: motors and servos unresponsive,
    // then outright freezing.
    //
    // Earlier experiments tried mitigations such as skipping reads while
    // driving and adaptive backoff. The final latency fix is stronger:
    //
    //   - Manual/Line: never POLL Ultrasonic(); only an explicit v49 one-shot may read it.
    //   - Avoid: distance is required, so poll there and use adaptive
    //     backoff when the expensive no-echo result persists.
    // This is why Telemetry alone is not enough: even an unsent sensor
    // reading can freeze the runtime before BLE gets a chance to run.
    // Low-latency control build: never POLL Ultrasonic() in Manual/Line; v49 permits one explicit read.
    // A no-echo read can busy-wait for ~250ms and freeze BLE command
    // handling. Avoid is the only mode with automatic distance polling; v49 also supports an explicit one-shot in any mode.
    // v49: distance has TWO triggers:
    //   1) normal automatic polling in Avoid mode;
    //   2) an explicit one-shot from the CFG selector in ANY mode.
    // The one-shot deliberately ignores busyDriving because the operator asked
    // for it explicitly. It can therefore cause one brief HC-SR04 timeout stall,
    // but it never turns continuous polling back on in Manual/Line.
    let forceDist = forceDistanceOnce
    // Poll in EVERY mode, not only Avoid. The Distance-read selector offers
    // "Auto", and with Telemetry on All the graph is expected to keep drawing
    // -- in Manual it drew nothing at all, because this used to require
    // MODE_AVOID and the only other path was the one-shot "Read now".
    //
    // What actually makes polling unsafe is not the mode but driving:
    // Ultrasonic() busy-waits, and a missing echo costs ~250ms with the whole
    // runtime frozen. busyDriving below is that guard, and it still applies --
    // so the graph runs while the robot is parked, which is when anyone is
    // looking at it, and stops the moment the wheels turn.
    //
    // Avoid mode must keep measuring whatever the telemetry level says -- the
    // distance is its input, not a readout, and gating it on UPD_ALL would
    // leave the robot driving blind at Basic or Off. Outside Avoid the reading
    // exists only to be displayed, so it is not worth the stall unless the
    // graph and gauge can actually leave the robot, which is UPD_ALL only
    // (see sendValue).
    let autoDistDue = (driveMode == MODE_AVOID || updLevel == UPD_ALL) && now >= nextDistAt
    let busyDriving = (lastDriveL != 0 || lastDriveR != 0) && driveMode != MODE_AVOID
    if (cfgSent && (forceDist || (autoDistDue && !busyDriving))) {
        if (forceDist) forceDistanceOnce = false
        // Must advance in every mode now. Leaving this Avoid-only would let
        // the loop re-measure on every pass, which is precisely the freeze
        // the interval exists to prevent.
        nextDistAt = now + distInterval
        {
            let cm = maqueen.Ultrasonic()
            // Adapt the next interval to what we just got back. 500 is
            // the "no echo" sentinel and is the reading that costs the
            // full ~250ms retry stall, so keep backing off while it
            // persists; any real distance restores the fast rate.
            // Backoff applies in every mode for the same reason it exists in
            // Avoid: a sensor that never echoes costs the full retry stall on
            // each attempt, so slow down while that persists and recover the
            // fast rate as soon as a real distance comes back.
            if (cm >= 500 || cm <= 0) {
                distInterval = Math.min(distInterval * 2, DIST_INTERVAL_MAX_MS)
            } else {
                distInterval = DIST_INTERVAL_MS
            }
            // Decide what we'd report; -1 means "nothing to report".
            let reported = -1
            if (cm >= 500) {
                // pxt-maqueen's "no echo" sentinel. No echo means
                // nothing bounced back, i.e. the path is CLEAR — so
                // report the top of the gauge, not 0. Reporting 0 would
                // read as "obstacle touching the bumper", the exact
                // opposite of the truth.
                reported = DIST_MAX_CM
            } else if (cm > 0) {
                reported = Math.min(cm, DIST_MAX_CM)
            } else {
                // cm <= 0 is a bad read, not a measurement. Skip the
                // update and leave the last good value on screen rather
                // than inventing a number in either direction.
                dbg("dist: bad read (" + cm + ")")
            }
            // Raw value logged on every poll, so flipping debugEnabled
            // on answers "is this sensor alive at all?" directly rather
            // than by inference from the graph.
            dbg("dist raw=" + cm + " next=" + distInterval + "ms")

            // Sent on EVERY poll, deliberately not deduped. A change-only
            // rule is right for a gauge — a repeated identical number
            // tells the viewer nothing — but wrong for a graph, which is
            // a time series: with no new samples a steady reading draws
            // no points at all and looks like a dead feed. That is
            // exactly how it appeared when parked facing open space,
            // where every reading is the same 200 "no echo" sentinel.
            //
            // The cost is one short message per poll, and polls are
            // already rate-limited by distInterval and skipped entirely
            // while driving, so this adds very little traffic.
            //
            // The graph widget takes comma-separated numbers, one per
            // series; a single series means a bare number is the payload.
            //
            // The RAW cm goes to the graph, not the mapped `reported`.
            // `reported` folds pxt-maqueen's 500 "no echo" sentinel down
            // to DIST_MAX_CM (200), which made "nothing bounced back"
            // indistinguishable from "an object exactly 200cm away" — so
            // a sensor that never echoes looked identical to a clear
            // path, and the graph could not tell us which. Raw values
            // are unambiguous: a flat line at 500 means no echo, ever;
            // anything under 400 is a real measurement. The graph
            // auto-scales, so the wider range costs nothing.
            //
            // `reported` is still what drives the alert and Avoid mode,
            // where "no echo == far away" is the correct reading.
            if (cm > 0) {
                if (forceDist) sendUiValue("graph_dist", "" + cm)
                else sendValue("graph_dist", "" + cm)
            }
            // The gauge gets the MAPPED value: on a dial, "no echo"
            // should read as a clear path (full scale), not as an
            // obstacle against the bumper. The graph gets the raw value
            // instead, so the two together still distinguish a dead
            // sensor from an empty room.
            if (reported >= 0) {
                if (forceDist) sendUiValue("gauge_dist", "" + reported)
                else sendValue("gauge_dist", "" + reported)
                // The OLED has no reading of its own; this is the only place
                // one is retained between polls.
                lastDistShown = reported
            }

            // Reset the momentary CFG selector after the requested sample.
            // sendUiValue bypasses the Telemetry selector on purpose: this is
            // direct feedback to an explicit user action, not background data.
            if (forceDist) sendUiValue("dist_read", "Auto")

            // Obstacle alert, with hysteresis so it fires once on
            // approach instead of chattering around the threshold: it
            // arms below ALERT_CM and only re-arms once the path is
            // clear past ALERT_CLEAR_CM.
            if (reported >= 0) {
                if (!alertActive && reported < ALERT_CM) {
                    alertActive = true
                    sendValue("alert", "Obstacle " + reported + "cm")
                    dbg("alert: obstacle at " + reported + "cm")
                } else if (alertActive && reported > ALERT_CLEAR_CM) {
                    alertActive = false
                    dbg("alert: cleared")
                }
            }

            // Obstacle avoidance: reverse briefly, then pivot, then
            // resume. Phases are driven by timestamps, never by pauses,
            // so the loop keeps servicing the radio and the watchdog.
            if (driveMode == MODE_AVOID) {
                if (avoidPhase == 0) {
                    if (reported >= 0 && reported < AVOID_STOP_CM) {
                        avoidPhase = 1
                        avoidUntil = now + 600
                        driveAuto(0, -1)         // back up
                    } else {
                        driveAuto(0, 1)          // path clear -> cruise
                    }
                } else if (avoidPhase == 1 && now >= avoidUntil) {
                    avoidPhase = 2
                    avoidUntil = now + 500
                    driveAuto(1, 0)              // pivot away
                } else if (avoidPhase == 2 && now >= avoidUntil) {
                    avoidPhase = 0
                }
                lastDriveCmdAt = now            // keep the watchdog satisfied
            }
        }
    }

    // Drain ONE queued debug line per tick (see dbg() above for why
    // this can't happen synchronously from onUartDataReceived). At
    // most 10/sec — plenty for discrete dpad/button/servo events,
    // and naturally paced by the same 100ms this loop already pauses.
    if (cfgSent && logQueue.length > 0 && (lastDriveL == 0 && lastDriveR == 0) && now - lastDriveCmdAt > 500) {
        bluetooth.uartWriteLine("LOG " + logQueue.shift())
    }

    basic.pause(100)
})
