const CLAIM_BYTES = 8 * 1024 * 1024;
const MODULE_BYTES = 32 * 1024 * 1024;
const FIRST_SOURCE_BYTES = CLAIM_BYTES / 2;

// Module-instance accounting only: neither bytes nor account IDs escape a claim.
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
const moduleBudget = createSourceBudget(MODULE_BYTES);

/** Encoded bytes only; no account/source identity or native RSS is exposed. */
export function getApparelRetainedSourceBytes() {
  return moduleBudget.usedBytes;
}

// Construct inside one authorized dispatch claim; never share this reader across runs.
// Keep early admitted sources instead of evicting them during preflight/render passes.
export function createApparelSourceReader(
  load: (id: string) => Promise<Uint8Array>,
  check: (id: string) => void,
  { maxBytes = CLAIM_BYTES, budget = moduleBudget } = {},
) {
  const retained = new Map<string, Uint8Array>();
  const pending = new Map<string, Promise<Uint8Array>>();
  const excluded = new Set<string>();
  let usedBytes = 0;
  let disposed = false;
  let bypass = false;
  const active = (id: string) => {
    if (disposed) throw new Error("source_reader_disposed");
    check(id);
  };
  return {
    get retainedBytes() {
      return usedBytes;
    },
    get excludedSourceCount() {
      return excluded.size;
    },
    async read(id: string): Promise<Uint8Array> {
      active(id);
      if (bypass || excluded.has(id)) {
        const bytes = await load(id);
        active(id);
        return bytes;
      }
      const hit = retained.get(id);
      if (hit) return hit;
      let promise = pending.get(id);
      if (!promise) {
        promise = (async () => {
          const bytes = await load(id);
          active(id);
          if (bypass) return bytes;
          // A large first input leaves little reuse coverage. Keep baseline
          // byte lifetimes/bookkeeping for this claim, including pending inputs.
          // Mixed/duplicate large-input plans deliberately lose potential gains.
          if (retained.size === 0 && bytes.byteLength > FIRST_SOURCE_BYTES) {
            bypass = true;
            excluded.clear();
          } else if (bytes.byteLength > maxBytes - usedBytes) {
            // Immutable sources cannot fit later in this claim; skip bookkeeping
            // on subsequent serial renderer reads. Transient module contention
            // is not an exclusion, so capacity can recover after another claim.
            excluded.add(id);
          } else if (budget.reserve(bytes.byteLength)) {
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
      excluded.clear();
      budget.release(usedBytes);
      usedBytes = 0;
    },
  };
}
