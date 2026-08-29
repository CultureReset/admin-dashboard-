# Cupertino Pi

An iOS-shaped shell prototype for Raspberry Pi. No frameworks, no build step, no Apple assets.

- `index.html` — the shell. Open it in a browser, or serve the folder and point a kiosk at it.
- `ROADMAP.html` — the build plan: three layers, stack decision, six phases, the layout numbers.

Both files are standalone. `index.html` injects its own viewport meta when the host has not
supplied one, so it lays out correctly served from `file://` or from nginx on the Pi.

## What is real

- A spring integrator (semi-implicit Euler, sub-stepped) driving every animation, each one
  interruptible — `stop()` returns position *and* velocity so a gesture can catch it mid-flight.
- Rubber-banded pagination: `offset = (x·d·c) / (d + c·|x|)`, `c = 0.55`.
- Superellipse icon masks at `n = 5`, generated at load and applied as a scaling SVG mask.
- App open and close animating from the tapped icon's rect, drivable by finger or by spring.
- Swipe-up-and-hold to the switcher, armed on **dwell time**. Velocity is useless here: during a
  hold no `pointermove` fires, so the last sample never decays.
- Control Center and Notification Center as draggable overlays with committed/dismissed snapping.
- Settings rendered from a schema (`SCHEMA`), not hand-built screens. Every row names the Linux
  service it would bind to. Brightness dims the real screen; Text Size re-flows the real grid.

## What is not

It is a web page: no compositor, no transports. Every "app" is drawn by the same page rather than
hosted. That boundary is deliberate — see Phase 4 in the roadmap.

## Layout constants

`COLS = 4`, `ROWS = 6` (24 per page) plus a 4-slot dock, in `index.html`. Column gap at 393 pt:
`(393 − 4×60 − 2×27) ÷ 3 = 33 pt`. All of it is config, which is what Text Size demonstrates.

## Under the bezel

A live-blur toggle and a frame counter. Backdrop blur is the most likely thing to blow the frame
budget on a Pi — measure it here before committing to the design.
