# Open Glasses Spec

Two standalone documents, no build step. Open either in a browser.

- `SPEC.html` — **Open Glasses Spec.** The engineering layer under the ten-slide
  *Open Smart Glasses Ecosystem* deck: what the system does, in numbers and schemas.
- `BUILD.html` — **Building the Node.** How to build it, and how every part stays
  separated per person.
- `LAUNCH.html` — **Zero to Launch.** The execution plan: six phases, five kill gates,
  what to buy, what to write in order, and honest time and money.

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


---

# Building the Node

`BUILD.html` — the implementation companion. Isolation is the one property that cannot be
added later, so this describes the shape it has to have from the first commit.

## Nine boundaries

Data (RLS, forced) · blobs (per-person keys) · apps (WASM sandbox) · inference (scoped
retrieval, exact-prefix cache keys) · identity nodes · sessions · network · egress · backups.

## The rule underneath all of them

**Person is never a function parameter.** It is ambient context established once at the device
session and read by every gate below. The moment an app can *pass* a person id, isolation is a
code review problem rather than a structural one — and code review does not scale to an app store.

## The two tests that pay for themselves

- CI fails if any table lacks `person_id`, or lacks row level security both **enabled** and
  **forced**. Stops the slow decay where someone adds a table in a hurry.
- Two people interleaved through one **pooled** connection never see each other's rows. Catches
  the `SET` without `LOCAL` leak, which ordinary test suites never reproduce because they run
  one person at a time.

## The checkpoint

Adding the second person must require zero schema changes, zero new parameters and zero special
cases. Seed a second person in phase 0 and keep them in every test run — that is what stops the
system quietly becoming single-tenant.


---

# Zero to Launch

`LAUNCH.html` — what you actually do, in what order, and where you are allowed to stop.

## The framing that changes everything

**Launch the platform, not the hardware.** The architecture doc reached this conclusion itself in
§24–25: the defensible thing is the device protocol and the node, not the frames. Publish the
protocol, the node, and a reference build anyone can assemble from ~$60 of parts. You get the
ecosystem without becoming a manufacturer, which is the specific way projects like this die.

## The riskiest assumption is not technical

Nothing in the spec is research; it is all buildable. The real risk is whether you will reach for
it. Phase −1 tests that in two weeks for $0 — phone in a shirt pocket, one earbud, a note file —
before any hardware exists. Every hour spent there is insurance against the most expensive version
of being wrong, and it is the phase people skip because it does not feel like building.

## Firmware is the ninth file you write, not the first

The glasses are stateless by design, so a laptop webcam and `curl` are a complete stand-in for
them. Writing firmware first means debugging your architecture through a serial cable.

## Six phases, five gates

| Phase | Gate |
|---|---|
| −1 Fake it · 2 wk · $0 | Used it 3× a day, sustained into week two? |
| 0 Node · 4 wk | Answers in under 1.2 s, twenty times? |
| 1 Wearable · 4 wk | Worn a week without fuss? |
| 2 Apps · 3 wk | Second person works with zero code changes? |
| 3 Ten people · 8 wk | Six of ten still wearing it at week four? |
| 4 Ship · 4 wk | A stranger builds the reference hardware and files an issue. |

Roughly nine months of evenings to launch, five to the point where it works for two people.
About $400 to that point if you already own a Mac.
