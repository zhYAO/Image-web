const CLAIM_BYTES = 8 * 1024 * 1024;
const PROCESS_BYTES = 32 * 1024 * 1024;

// Process-wide accounting only: neither source bytes nor account IDs escape a claim.
export function createSourceBudget(maxBytes: number) {
  let usedBytes = 0;
  return {
    get usedBytes() {
      return usedBytes;
    },
    reserve(bytes: number) {
      if (bytes > maxBytes - usedBytes) return false;
      usedBytes += bytes;
      return true;
    },
    release(bytes: number) {
      usedBytes -= bytes;
    },
  };
}
const processBudget = createSourceBudget(PROCESS_BYTES);

// Construct inside one authorized dispatch claim; never share this reader across runs.
// Keep early admitted sources instead of evicting them during preflight/render passes.
export function createApparelSourceReader(
  load: (id: string) => Promise<Uint8Array>,
  check: (id: string) => void,
  { maxBytes = CLAIM_BYTES, budget = processBudget } = {},
) {
  const retained = new Map<string, Uint8Array>();
  const pending = new Map<string, Promise<Uint8Array>>();
  let usedBytes = 0;
  let disposed = false;
  const active = (id: string) => {
    if (disposed) throw new Error("source_reader_disposed");
    check(id);
  };
  return {
    async read(id: string): Promise<Uint8Array> {
      active(id);
      const hit = retained.get(id);
      if (hit) return hit;
      let promise = pending.get(id);
      if (!promise) {
        promise = (async () => {
          const bytes = await load(id);
          active(id);
          if (
            bytes.byteLength <= maxBytes - usedBytes &&
            budget.reserve(bytes.byteLength)
          ) {
            retained.set(id, bytes);
            usedBytes += bytes.byteLength;
          }
          return bytes;
        })();
        pending.set(id, promise);
      }
      try {
        const bytes = await promise;
        active(id);
        return bytes;
      } finally {
        if (pending.get(id) === promise) pending.delete(id);
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      retained.clear();
      pending.clear();
      budget.release(usedBytes);
      usedBytes = 0;
    },
  };
}
