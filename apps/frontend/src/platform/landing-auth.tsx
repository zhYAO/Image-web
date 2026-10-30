import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useRuntime } from './runtime-provider';

const Context = createContext(false);
export const useLandingAuthorized = () => useContext(Context);
export const WORKSPACE_LOGIN_HREF = '/login?returnTo=%2Fworkspace';

/** Public navigation is enhanced only after the runtime pair is accepted. */
export function LandingAuthProvider({ children }: { children: ReactNode }) {
  const runtime = useRuntime();
  const enabled = runtime.status === 'ready' && runtime.value.config.formalAuth;
  const [authorized, setAuthorized] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    let epoch = 0;
    let pending: AbortController | undefined;
    let checkedAt = 0;
    const expire = () => { epoch++; pending?.abort(); pending = undefined; setAuthorized(false); };
    const refresh = () => {
      if (!alive || pending || document.hidden) return;
      const current = ++epoch;
      pending = new AbortController();
      const signal = AbortSignal.any([pending.signal, AbortSignal.timeout(15_000)]);
      void fetch('/api/auth/session', { method: 'GET', cache: 'no-store', credentials: 'same-origin', redirect: 'error', signal })
        .then(async response => {
          const value: unknown = response.ok && /^application\/json(?:;|$)/i.test(response.headers.get('content-type') ?? '') ? await response.json() : undefined;
          if (!alive || current !== epoch) return;
          const id = value && typeof value === 'object' && 'id' in value ? value.id : undefined;
          setAuthorized(typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id));
        })
        .catch(() => { if (alive && current === epoch) setAuthorized(false); })
        .finally(() => { if (current === epoch) { pending = undefined; checkedAt = Date.now(); } });
    };
    const changed = (event: Event) => { expire(); if ((event as CustomEvent<boolean>).detail) refresh(); };
    const visible = () => { if (!document.hidden && Date.now() - checkedAt > 1000) refresh(); };
    const initial = window.setTimeout(refresh, 0);
    window.addEventListener('zimage:auth-required', expire);
    window.addEventListener('zimage:auth-changed', changed);
    window.addEventListener('focus', visible);
    document.addEventListener('visibilitychange', visible);
    return () => {
      alive = false; epoch++; pending?.abort(); window.clearTimeout(initial);
      window.removeEventListener('zimage:auth-required', expire);
      window.removeEventListener('zimage:auth-changed', changed);
      window.removeEventListener('focus', visible);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [enabled]);
  return <Context.Provider value={enabled && authorized}>{children}</Context.Provider>;
}
