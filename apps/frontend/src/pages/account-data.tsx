import { accountSchema, type Account } from '@zimage/domain';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { notifyAuthChange } from '../platform/auth-status';

type Result = { status: 'checking' | 'error' | 'guest' } | { status: 'ready'; account: Account };
type Value = Result & { refresh: () => void };
const Context = createContext<Value>({ status: 'checking', refresh() {} });
export const useAccountData = () => useContext(Context);

/** Data refresh replaces server page refresh. Owner identity is checked twice. */
export function AccountData({ ownerId, children }: { ownerId: string; children: ReactNode }) {
  const [attempt, setAttempt] = useState(0);
  const refresh = useCallback(() => setAttempt(value => value + 1), []);
  const scope = `${ownerId}:${attempt}`;
  const [result, setResult] = useState<{ scope: string; value: Result }>();
  useEffect(() => {
    let alive = true;
    const controller = new AbortController();
    void fetch('/api/account', { method: 'GET', cache: 'no-store', credentials: 'same-origin', redirect: 'error', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]) })
      .then(async response => {
        if (response.status === 401) { if (alive) { notifyAuthChange(false); setResult({ scope, value: { status: 'guest' } }); } return; }
        if (!response.ok || !/^application\/json(?:;|$)/i.test(response.headers.get('content-type') ?? '')) throw new Error('Account unavailable');
        const account = accountSchema.parse(await response.json());
        if (account.id !== ownerId) throw new Error('Account identity mismatch');
        if (alive) setResult({ scope, value: { status: 'ready', account } });
      }).catch(() => { if (alive) setResult({ scope, value: { status: 'error' } }); });
    return () => { alive = false; controller.abort(); };
  }, [ownerId, scope]);
  const value: Result = result?.scope === scope ? result.value : { status: 'checking' };
  return <Context.Provider value={{ ...value, refresh }}>{children}</Context.Provider>;
}
