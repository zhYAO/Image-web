import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { loadPublicRuntime, type PublicRuntime } from './public-config';
import { checkRuntimeCompatibility } from './compatibility';

export type RuntimeState =
  | { status: 'checking' }
  | { status: 'unavailable' }
  | { status: 'incompatible' }
  | { status: 'ready'; value: PublicRuntime };
const Context = createContext<RuntimeState>({ status: 'checking' });
export const useRuntime = () => useContext(Context);

/** Non-blocking for public content. A bad/disallowed pair cannot open private slots. */
export function RuntimeProvider({ descriptor, children }: { descriptor?: unknown; children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<{ descriptor: unknown; state: RuntimeState }>(() => ({ descriptor, state: { status: 'checking' } }));
  useEffect(() => {
    const controller = new AbortController();
    let alive = true;
    void loadPublicRuntime({ signal: controller.signal }).then(value => {
      if (alive) setSnapshot({ descriptor, state: checkRuntimeCompatibility(descriptor, value.meta).compatible ? { status: 'ready', value } : { status: 'incompatible' } });
    }).catch(() => { if (alive) setSnapshot({ descriptor, state: { status: 'unavailable' } }); });
    return () => { alive = false; controller.abort(); };
  }, [descriptor]);
  const state: RuntimeState = snapshot.descriptor === descriptor ? snapshot.state : { status: 'checking' };
  return <Context.Provider value={state}>{children}</Context.Provider>;
}
