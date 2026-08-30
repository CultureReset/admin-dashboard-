# Open Glasses Spec

`SPEC.html` — the engineering layer under the ten-slide *Open Smart Glasses Ecosystem* deck.
Standalone, no build step. Open it in a browser.

## Why it exists

The deck says what the system is. This says what it does, in numbers and schemas, and lists
every place the deck and the architecture doc contradict each other (§15).

## What it settles

- **§3 Device Protocol v1** — eleven verbs, a capability descriptor, versioning rules. The deck
  had an *app* protocol but no *device* protocol; this is the part third parties build against.
- **§4 The Observation** — the core datatype, used in the architecture doc's own example and
  defined nowhere. Everything reads it; only the capture pipeline writes it.
- **§6 Identity** — one Android device per person. Physical, not virtual: Play Integrity fails on
  emulators, and container Android needs Linux kernel binder that macOS cannot provide.
- **§11 Power** — the finding that changes the hardware. The Pi Zero 2 W has no suspend-to-RAM,
  so it cannot be duty-cycled, so it must run continuously, so it needs 105 g of battery. Ray-Ban
  Meta is 50 g in total. An ESP32-S3 does the same job on ~5 g.
- **§12 Latency** — 2730 ms serial vs 990 ms optimised, from end-of-speech. Pure scheduling.
- **§13 Degradation** — slide 4 lists Availability as a routing input with no output path.

## Recomputing the power budget

The figures in §11 come from `power.py`: 16 waking hours, 30 queries/day, 87% conversion
efficiency, ~20 g per 1000 mAh including protection circuitry. Change the assumptions and re-run.

```bash
python3 power.py
```

## Status legend

`DECIDED` settled · `SPEC` normative · `OPEN` needs a decision · `FIX` contradicts the deck

Six decisions are still open; they are listed together in §17.3.
