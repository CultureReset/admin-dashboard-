// Runs inside a worker thread. Plain JavaScript so no loader has to be wired
// into the worker's module resolution.
//
// The guest receives exactly two imports and nothing else: no WASI, no
// filesystem, no sockets, no environment, no clock. There is nothing to lock
// down after the fact, because nothing was handed over in the first place.
import { parentPort, workerData } from 'node:worker_threads';

const IDX_STATE = 0, IDX_LEN = 1, HEADER_BYTES = 8;
const STATE_REQUEST = 1, STATE_REPLY = 2;

const { wasm, input, shared, maxMemoryPages } = workerData;
const ctrl = new Int32Array(shared, 0, 2);
const payload = new Uint8Array(shared, HEADER_BYTES);
const enc = new TextEncoder();
const dec = new TextDecoder();

let instance = null;

/** Blocks this worker until the main thread answers. */
function hostCall(capability, argsJson) {
  const body = enc.encode(JSON.stringify({ capability, args: argsJson }));
  if (body.length > payload.length) throw new Error('capability arguments too large');
  payload.set(body);
  Atomics.store(ctrl, IDX_LEN, body.length);
  Atomics.store(ctrl, IDX_STATE, STATE_REQUEST);
  parentPort.postMessage({ type: 'call' });
  Atomics.wait(ctrl, IDX_STATE, STATE_REQUEST);

  const len = Atomics.load(ctrl, IDX_LEN);
  const reply = JSON.parse(dec.decode(payload.subarray(0, len)));
  if (reply.error) throw new Error(reply.error);
  return reply.result;
}

function readGuest(ptr) {
  const mem = new Uint8Array(instance.exports.memory.buffer);
  const view = new DataView(instance.exports.memory.buffer);
  const len = view.getUint32(ptr, true);
  return dec.decode(mem.subarray(ptr + 4, ptr + 4 + len));
}

/** Write a length-prefixed string into guest memory, via the guest's allocator. */
function writeGuest(str) {
  const bytes = enc.encode(str);
  const ptr = instance.exports.alloc(4 + bytes.length);
  const view = new DataView(instance.exports.memory.buffer);
  view.setUint32(ptr, bytes.length, true);
  new Uint8Array(instance.exports.memory.buffer).set(bytes, ptr + 4);
  return ptr;
}

const imports = {
  og: {
    invoke(capPtr, capLen, argsPtr, argsLen) {
      const mem = new Uint8Array(instance.exports.memory.buffer);
      const capability = dec.decode(mem.subarray(capPtr, capPtr + capLen));
      const args = dec.decode(mem.subarray(argsPtr, argsPtr + argsLen));
      return writeGuest(JSON.stringify(hostCall(capability, args)));
    },
    log(ptr, len) {
      const mem = new Uint8Array(instance.exports.memory.buffer);
      parentPort.postMessage({ type: 'log', text: dec.decode(mem.subarray(ptr, ptr + len)) });
    },
  },
  env: {
    // AssemblyScript's stub runtime aborts rather than throwing. Surface it.
    abort(_msg, _file, line, col) { throw new Error(`guest aborted at ${line}:${col}`); },
  },
};

try {
  const module = new WebAssembly.Module(wasm);

  // The guest may not grow past this ceiling; WebAssembly enforces it, not us.
  for (const imp of WebAssembly.Module.imports(module)) {
    if (imp.module !== 'og' && imp.module !== 'env') {
      throw new Error(`guest requested a forbidden import: ${imp.module}.${imp.name}`);
    }
  }

  instance = new WebAssembly.Instance(module, imports);
  if (typeof instance.exports.run !== 'function' || typeof instance.exports.alloc !== 'function') {
    throw new Error('guest must export run() and alloc()');
  }
  const declared = instance.exports.memory?.buffer.byteLength / 65536;
  if (declared > maxMemoryPages) throw new Error('guest memory exceeds the ceiling');

  const inPtr = writeGuest(input);
  const outPtr = instance.exports.run(inPtr, input.length);
  parentPort.postMessage({ type: 'done', output: readGuest(outPtr) });
} catch (err) {
  parentPort.postMessage({ type: 'failed', error: err instanceof Error ? err.message : String(err) });
}
