/**
 * Shared-memory layout between the sandbox host and the worker running a guest.
 *
 * The guest calls capabilities synchronously — WebAssembly imports cannot await
 * — but the host's capabilities are async, because they touch Postgres. The
 * bridge is a worker thread that blocks on Atomics.wait while the main thread
 * resolves the call. Running the guest in a worker has a second, larger benefit:
 * a runaway app can actually be terminated, which is what makes a fuel budget
 * enforceable rather than advisory.
 */
export const IDX_STATE = 0;
export const IDX_LEN = 1;
export const HEADER_BYTES = 8;          // two Int32s
export const PAYLOAD_BYTES = 1 << 20;   // 1 MiB of arguments and results

export const STATE_RUNNING = 0;   // guest is executing
export const STATE_REQUEST = 1;   // guest wants a capability; host must answer
export const STATE_REPLY   = 2;   // host has written a result; guest may resume

export interface SandboxLimits {
  /** Wall-clock ceiling. Exceeding it terminates the worker outright. */
  deadlineMs: number;
  /** Capability calls allowed. One badly written app must not pin a core. */
  maxCalls: number;
  /** Guest memory ceiling, in 64 KiB pages. */
  maxMemoryPages: number;
}

export const DEFAULT_LIMITS: SandboxLimits = {
  deadlineMs: 2_000,
  maxCalls: 32,
  maxMemoryPages: 64,     // 4 MiB
};
