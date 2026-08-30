/** A deliberately runaway guest, so the deadline has something real to kill. */
export function alloc(size: i32): usize { return heap.alloc(size); }
export function run(_p: usize, _l: i32): usize { while (true) {} }
