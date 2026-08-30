/**
 * The entire surface a sandboxed app can reach.
 *
 * There is no filesystem, no socket, no clock, no environment — the host
 * provides exactly these two imports and nothing else, so the sandbox boundary
 * and the permission boundary are the same line of code rather than two things
 * that have to agree.
 */

@external("og", "invoke")
declare function __invoke(capPtr: usize, capLen: i32, argsPtr: usize, argsLen: i32): usize;

@external("og", "log")
declare function __log(ptr: usize, len: i32): void;

/** Length-prefixed UTF-8: [u32 little-endian length][bytes]. */
export function packString(s: string): usize {
  const buf = String.UTF8.encode(s);
  const len = buf.byteLength;
  const out = heap.alloc(4 + len);
  store<u32>(out, len as u32);
  memory.copy(out + 4, changetype<usize>(buf), len);
  return out;
}

export function unpackString(ptr: usize): string {
  const len = load<u32>(ptr) as i32;
  return String.UTF8.decodeUnsafe(ptr + 4, len);
}

/** Call a host capability. Blocks the guest; the host resolves it and resumes. */
export function invoke(capability: string, argsJson: string): string {
  const cap = String.UTF8.encode(capability);
  const args = String.UTF8.encode(argsJson);
  const res = __invoke(changetype<usize>(cap), cap.byteLength,
                       changetype<usize>(args), args.byteLength);
  return unpackString(res);
}

export function log(msg: string): void {
  const b = String.UTF8.encode(msg);
  __log(changetype<usize>(b), b.byteLength);
}

/** The host allocates inside guest memory through this. */
export function alloc(size: i32): usize { return heap.alloc(size); }
