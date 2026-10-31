import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { loadPublicRuntime, type PublicRuntime } from './public-config';
import { checkRuntimeCompatibility } from './compatibility';

export type RuntimeState =
  | { status: 'checking' }
  | { status: 'unavailable' }
  | { status: 'incompatible' }
  | { status: 'ready'; value: PublicRuntime };
type RuntimeContext = RuntimeState & { retry: () => void };
const Context = createContext<RuntimeContext>({ status: 'checking', retry: () => {} });
export const useRuntime = () => useContext(Context);

/** Non-blocking for public content. A bad/disallowed pair cannot open private slots. */
export function RuntimeProvider({ descriptor, children }: { descriptor?: unknown; children: ReactNode }) {
  const [attempt, setAttempt] = useState(0);
  const retryQueued = useRef(false);
  const [snapshot, setSnapshot] = useState<{ descriptor: unknown; attempt: number; state: RuntimeState }>(() => ({ descriptor, attempt: 0, state: { status: 'checking' } }));
  useEffect(() => {
    retryQueued.current = false;
    const controller = new AbortController();
    let alive = true;
    void loadPublicRuntime({ signal: controller.signal }).then(value => {
      if (alive) setSnapshot({ descriptor, attempt, state: checkRuntimeCompatibility(descriptor, value.meta).compatible ? { status: 'ready', value } : { status: 'incompatible' } });
    }).catch(() => { if (alive) setSnapshot({ descriptor, attempt, state: { status: 'unavailable' } }); });
    return () => { alive = false; controller.abort(); };
  }, [descriptor, attempt]);
  const state: RuntimeState = snapshot.descriptor === descriptor && snapshot.attempt === attempt ? snapshot.state : { status: 'checking' };
  const retry = useCallback(() => {
    // Only the two public GETs are retried. A rejected release pair stays closed.
    if (state.status !== 'unavailable' || retryQueued.current) return;
    retryQueued.current = true;
    setAttempt(current => current + 1);
  }, [state.status]);
  return <Context.Provider value={{ ...state, retry }}>{children}</Context.Provider>;
}
