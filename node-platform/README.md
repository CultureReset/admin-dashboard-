# Open Glasses — node

The private node from the spec, running. Device protocol server, capability
host, per-person isolation, a router, three apps, and a software pair of
glasses to drive it with.

No hardware. No models. No setup.

```bash
npm install
npm run dev                      # terminal 1 — the node
npm run device -- --scenario     # terminal 2 — the glasses
```

## What actually runs

```
▸ "what is that?"  [fixture:eagle]
  speak    That's a bald eagle, Haliaeetus leucocephalus.
  lens     bald eagle / Haliaeetus leucocephalus / 92% confident
  timing   stt=250ms  vision_prepare_blocked=1ms  vision_answer=300ms  tts_first_chunk=150ms
  total    710ms from end of speech
```

## Why there is no hardware here

The glasses are stateless by design, so a WebSocket client is a complete
stand-in for them. That is why `firmware/` does not exist yet and the simulator
does: debugging the architecture in a terminal takes seconds, and debugging it
through a serial cable takes minutes. Firmware is the ninth thing to write, not
the first.

## The one measurement worth running yourself

The frame goes up when you **tap**, not when you stop talking — so the expensive
half of vision runs while you are still speaking. Run it both ways:

```bash
npm run device -- --say "what is that?" --image fixture:eagle          # 710ms
npm run device -- --say "what is that?" --image fixture:eagle --cold   # 908ms
```

`vision_prepare_blocked` goes from 1ms to 201ms. Same models, same work, ~200ms
of difference from scheduling alone.

## Isolation

Two people are seeded from the first run, with one user. That is not decoration:
keeping an empty second account in every test run is what stops the system
quietly becoming single-tenant.

```bash
npm run check:rls        # fails if any table lacks person_id or forced RLS
npm test                 # 34 tests, including the isolation suite
```

What the suite proves, generated from the schema rather than written per table
so a table added next month is covered without anyone remembering:

- For **every** person-scoped table, B cannot read, update or delete A's rows.
- B cannot forge a row claiming to be A's — `WITH CHECK` refuses it.
- The schema gate catches a table added without protection (and the test proves
  the gate works by adding one).
- Person context does not survive its transaction. There is a test that
  deliberately reproduces the `SET` without `LOCAL` leak, to prove the guard can
  detect it — that bug is silent, and ordinary suites never reproduce it because
  they run one person at a time.
- Two apps under one person cannot read each other's storage; one app installed
  by two people gets two namespaces.
- A token minted for a different person is refused even with valid scopes.
- Revocation takes effect on the next call, not the next launch.

Superusers bypass RLS entirely, so the server drops to a non-superuser role for
every request. That role change is not defence in depth — it is the only thing
making the policies apply at all.

## Layout

```
proto.ts                    the device protocol: 11 verbs, capability descriptor
store/schema.sql            every table carries person_id
store/policies.sql          RLS applied by loop — you cannot add a table and forget
store/check-rls.ts          the CI gate
capabilities/host.ts        THE ONLY MODULE WITH A DATABASE HANDLE
capabilities/token.ts       scoped, expiring, revocable — never booleans
capabilities/policy.ts      per-element evaluation with redaction
pipeline/                   stt / visionPrepare / visionAnswer / tts, pure functions
router/classify.ts          classify once, dispatch directly — no ladder to climb
apps/registry.ts            the three V1 apps
session.ts                  one connection, one person, work in flight
gateway/server.ts           WebSocket; the device dials out, the node never dials in
device/simulator.ts         the glasses, in software
```

## The design rule everything rests on

Look at the handler signature in `capabilities/host.ts`:

```ts
type Handler<A, R> = (tx: Tx, args: A, meta: HandlerMeta) => Promise<R>;
```

There is nowhere to put a person id. Person is ambient context, established once
when the device authenticates and read by every gate below — so no app can name
a person other than the one it is already running as. Isolation is structural
rather than a review checklist, and review does not scale to an app store.

## Two things the tests found

**Failed calls left no receipt.** Writing the audit row inside the transaction is
right for a success — a crash between effect and receipt would otherwise produce
an unlogged action. But a failure rolls its own receipt back, and a refused call
is exactly what you most want in the log. Failures are now written after the
rollback, where there is no effect to be atomic with.

**Lexical recall cannot match "shoes" to "desert boots".** Rather than hide it,
`observation.search` reports how it matched and the app says so out loud:
*"Nothing matched 'shoes' exactly. The most recent thing I have is a pair of tan
suede desert boots."* Silently downgrading while sounding equally confident is
the failure mode that makes assistants untrustworthy. This is the gap a vector
index closes, and the shape of the answer will not change when one is added.

## Plugging in real models

`loadPipeline()` in `pipeline/index.ts` returns the mock. Implement the same
four methods against whisper.cpp, a local VLM and Piper, register it there, and
nothing above it changes — the mock latencies were chosen to approximate a
GPU-class node so the budget is exercised honestly in the meantime.

## Not built yet

Firmware, the WASM app sandbox, identity nodes, the companion phone app, and the
offline queue. See `../prototypes/glasses-spec/LAUNCH.html` for what order those
come in and which gates they sit behind.

## Try it

```bash
npm run device -- --person poppy --say "add this to my christmas list" --image fixture:lego
npm run device -- --person matt  --say "where did i see that boat?"
npm run device -- --person matt  --worn false     # presence gate refuses the request
npm run device -- --person matt  --battery 9      # under 15%: images stop being sent
```

Fixtures: `eagle`, `lego`, `plant`, `boat`, `shoes`, `engine`.
