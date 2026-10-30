import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useRuntime } from './runtime-provider';
import type { PublicRuntime } from './public-config';

type AuthStatus = 'checking' | 'authorized' | 'guest' | 'error';
type Identity = { status: AuthStatus; ownerId?: string; refresh: () => void };
const Context = createContext<Identity>({ status: 'checking', refresh() {} });
const noop = () => {};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Presentation identity only; every data request remains authenticated by API. */
export function AuthStatusProvider({ children, onIdentityReset = noop }: { children: ReactNode; onIdentityReset?: () => void }) {
  const runtime = useRuntime();
  const scope = runtime.status === 'ready' ? runtime.value : undefined;
  const enabled = Boolean(scope?.config.formalAuth);
  const [identity, setIdentity] = useState<Omit<Identity, 'refresh'> & { scope?: PublicRuntime }>({ status: 'checking' });
  const verifiedOwner = useRef<string | undefined>(undefined);
  const epoch = useRef(0);
  const pending = useRef<AbortController | null>(null);
  const checkedAt = useRef(0);
  const refresh = useCallback(() => {
    if (!enabled || pending.current || document.hidden) return;
    const controller = new AbortController();
    pending.current = controller;
    const current = ++epoch.current;
    void fetch('/api/auth/session', { method: 'GET', cache: 'no-store', credentials: 'same-origin', redirect: 'error', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]) })
      .then(async response => {
        const json: unknown = response.ok && /^application\/json(?:;|$)/i.test(response.headers.get('content-type') ?? '') ? await response.json() : undefined;
        if (current !== epoch.current) return;
        const id = json && typeof json === 'object' && 'id' in json ? json.id : undefined;
        const ownerId = typeof id === 'string' && uuid.test(id) ? id : undefined;
        if (response.ok && ownerId) {
          if (verifiedOwner.current && verifiedOwner.current !== ownerId) onIdentityReset();
          verifiedOwner.current = ownerId;
          setIdentity({ scope, status: 'authorized', ownerId });
        } else if (response.status === 401) {
          onIdentityReset(); verifiedOwner.current = undefined; setIdentity({ scope, status: 'guest' });
        } else setIdentity({ scope, status: 'error' });
      })
      .catch(() => { if (current === epoch.current) setIdentity({ scope, status: 'error' }); })
      .finally(() => { if (pending.current === controller) { pending.current = null; checkedAt.current = Date.now(); } });
  }, [enabled, scope, onIdentityReset]);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const requestEpoch = epoch;
    const initial = window.setTimeout(refresh, 0);
    const expire = () => {
      epoch.current++; pending.current?.abort(); pending.current = null;
      onIdentityReset(); verifiedOwner.current = undefined; setIdentity({ scope, status: 'guest' });
    };
    const changed = (event: Event) => {
      expire();
      if ((event as CustomEvent<boolean>).detail) { setIdentity({ scope, status: 'checking' }); refresh(); }
    };
    const visible = () => { if (alive && !document.hidden && Date.now() - checkedAt.current > 1000) refresh(); };
    window.addEventListener('zimage:auth-required', expire);
    window.addEventListener('zimage:auth-changed', changed);
    window.addEventListener('focus', visible);
    document.addEventListener('visibilitychange', visible);
    return () => {
      alive = false; requestEpoch.current++; pending.current?.abort(); pending.current = null;
      window.clearTimeout(initial);
      window.removeEventListener('zimage:auth-required', expire);
      window.removeEventListener('zimage:auth-changed', changed);
      window.removeEventListener('focus', visible);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [enabled, scope, onIdentityReset, refresh]);
  const current = enabled && identity.scope === scope ? identity : { status: enabled || runtime.status === 'checking' ? 'checking' as const : 'error' as const, ownerId: undefined };
  return <Context.Provider value={{ status: current.status, ownerId: current.ownerId, refresh }}>{children}</Context.Provider>;
}
export const useAuthStatus = () => useContext(Context);
export const notifyAuthChange = (authenticated: boolean) => window.dispatchEvent(new CustomEvent('zimage:auth-changed', { detail: authenticated }));
