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

## The WASM app sandbox

Third-party code on a machine holding someone's entire life gets a sandbox, not
a code review. `apps-wasm/plant-id` is a real app written in AssemblyScript,
compiled to a 6.8 KB module, running under `src/wasm/`.

```bash
npm run build:apps
npm run device -- --say "what kind of plant is that?" --image fixture:plant
```

A guest has **no ambient authority**. It gets exactly two imports — `og.invoke`
and `og.log` — and nothing else: no WASI, no filesystem, no sockets, no clock,
no environment. There is nothing to lock down after the fact because nothing was
handed over. A module asking for `wasi_snapshot_preview1.fd_write` is refused
before instantiation, and there is a test that builds one by hand to prove it.

Guests run in a **worker thread**, which solves two problems at once. WebAssembly
imports cannot await, but the host's capabilities are async because they touch
Postgres — so the guest blocks on `Atomics.wait` while the main thread resolves
the call. And a worker can actually be *terminated*, which is what makes the
deadline a budget rather than a suggestion. `apps-wasm/spin` loops forever on
purpose so the test has something real to kill.

The cost is honest: a sandboxed app answers in ~834 ms against ~709 ms for a
built-in — about 125 ms of worker spawn and three round trips. A worker pool
would remove most of it and has not been written.

The router cannot tell a guest from a first-party app. `install()` puts one in
the same list, and installed apps are matched first so a user can replace a
built-in with something better.

## Real models

`OG_PIPELINE=local` swaps the mock for actual backends. Two flavours cover
almost every local setup:

```bash
OG_PIPELINE=local OG_FLAVOUR=ollama OG_VLM_MODEL=qwen2.5vl:3b npm run dev
OG_PIPELINE=local OG_FLAVOUR=openai OG_VLM_URL=http://127.0.0.1:8080 npm run dev
```

`openai` covers llama.cpp `--server`, LM Studio, vLLM and whisper.cpp `--server`;
`ollama` covers `ollama serve`. TTS shells out to Piper and resolves on the first
audio chunk, since that is when playback can start.

`visionPrepare` warms the backend's prefix cache with the image and a trivial
prompt, so the encode happens during the utterance. The saving is real but
depends on the backend caching prefixes — llama.cpp and Ollama do. If yours does
not, it costs one cheap call and saves nothing, which is exactly why the number
is measured (`vision_prepare_blocked`) rather than assumed. A failed warm-up is
swallowed: it is an optimisation, not a dependency.

The adapters are tested against a stub server speaking the real wire formats, so
the request shape is verified without models installed. That proves we talk to
these servers correctly. It does not prove answer quality.

## Firmware

`firmware/` is a PlatformIO project for the Seeed XIAO ESP32-S3 Sense.

**It has not been flashed.** Nobody has run it on a board. The pin map and the
I2S timings are the two things most likely to need adjusting on first contact.

What *is* verified without hardware: `test/firmware.test.ts` reads the JSON
format strings straight out of `main.cpp` and parses them with the same zod
schema the gateway uses. Edit a format string and the test reads the new one, so
firmware and node cannot drift apart quietly. It also asserts the ordering that
the latency design depends on — frame uploaded at tap, audio streamed after,
request sent last — and that the utterance ends on silence rather than a fixed
wait, since a fixed wait would land straight on the critical path.

Writing that test caught a real robustness gap: a noisy or unattached ADC would
have emitted a battery percentage outside 0–100, and the node would have rejected
the whole message rather than degrading. It is clamped now.

## Not built yet

Identity nodes, the companion phone app, the offline queue, and a worker pool for
the sandbox. See `../prototypes/glasses-spec/LAUNCH.html` for what order those
come in and which gates they sit behind.

## Try it

```bash
npm run device -- --person poppy --say "add this to my christmas list" --image fixture:lego
npm run device -- --person matt  --say "where did i see that boat?"
npm run device -- --person matt  --worn false     # presence gate refuses the request
npm run device -- --person matt  --battery 9      # under 15%: images stop being sent
```

Fixtures: `eagle`, `lego`, `plant`, `boat`, `shoes`, `engine`.
