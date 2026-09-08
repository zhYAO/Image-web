'use client';

import Script from 'next/script';
import { useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { resetAuthRequiredNotification } from '@/gateways/http-workspace-gateway';
import { safeReturnTo } from '@/features/auth/return-to';
import { useAuthStatus } from '@/features/auth/AuthStatusProvider';
import { WorkspaceLoading } from '@/features/workspace/WorkspaceLoading';

interface TurnstileOptions {
  callback(token: string): void;
  'error-callback'(): void;
  'expired-callback'(): void;
  sitekey: string;
  theme: 'auto';
}

interface TurnstileApi {
  remove(widgetId: string): void;
  render(container: HTMLElement, options: TurnstileOptions): string;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

type GateStatus = 'challenge' | 'checking' | 'error' | 'ready' | 'signing-in';

function GateMessage({ children }: { children: ReactNode }) {
  return (
    <main aria-label="ZImage 身份验证" className="glass-page" style={{ display: 'grid', placeItems: 'center', textAlign: 'center' }}>
      <div>{children}</div>
    </main>
  );
}

export function AnonymousAuthGate({ children }: { children: ReactNode }) {
  if (process.env.NEXT_PUBLIC_PHASE2_AUTH === 'true') return <FormalAuthGate>{children}</FormalAuthGate>;
  return <LegacyAnonymousAuthGate>{children}</LegacyAnonymousAuthGate>;
}

function LegacyAnonymousAuthGate({ children }: { children: ReactNode }) {
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim();
  const captchaRequired = process.env.NEXT_PUBLIC_DATA_MODE === 'http' && Boolean(siteKey);
  const [client] = useState(() => captchaRequired ? createSupabaseBrowserClient() : null);
  const [scriptReady, setScriptReady] = useState(false);
  const [status, setStatus] = useState<GateStatus>(captchaRequired ? 'checking' : 'ready');
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!captchaRequired || !client) return;
    let active = true;
    void client.auth.getClaims().then(({ data }) => {
      if (!active) return;
      setStatus(data?.claims ? 'ready' : 'challenge');
    }).catch(() => {
      if (active) setStatus('error');
    });
    return () => {
      active = false;
    };
  }, [captchaRequired, client]);

  useEffect(() => {
    const turnstile = window.turnstile;
    const container = containerRef.current;
    if (status !== 'challenge' || !scriptReady || !turnstile || !container || !siteKey || !client) {
      return;
    }

    let widgetId: string;
    try {
      widgetId = turnstile.render(container, {
        callback(token) {
          setStatus('signing-in');
          void client.auth.signInAnonymously({ options: { captchaToken: token } })
            .then(({ error }) => setStatus(error ? 'error' : 'ready'))
            .catch(() => setStatus('error'));
        },
        'error-callback'() {
          setStatus('error');
        },
        'expired-callback'() {
          setStatus('error');
        },
        sitekey: siteKey,
        theme: 'auto',
      });
    } catch {
      queueMicrotask(() => setStatus('error'));
      return;
    }
    return () => turnstile.remove(widgetId);
  }, [client, scriptReady, siteKey, status]);

  if (status === 'ready') return children;
  if (status === 'error') {
    return (
      <GateMessage>
        <p>安全验证暂时未完成，请重试。</p>
        <button onClick={() => setStatus('challenge')} type="button">重新验证</button>
      </GateMessage>
    );
  }

  return (
    <GateMessage>
      <p>{status === 'signing-in' ? '正在建立匿名身份…' : '正在验证匿名身份…'}</p>
      {status === 'challenge' ? (
        <>
          <div ref={containerRef} />
          <Script
            id="zimage-turnstile"
            onError={() => setStatus('error')}
            onReady={() => setScriptReady(true)}
            src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
            strategy="afterInteractive"
          />
        </>
      ) : null}
    </GateMessage>
  );
}

function FormalAuthGate({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { status, refresh } = useAuthStatus();
  const [redirecting, setRedirecting] = useState(false);
  const redirectingRef = useRef(false);
  const redirectToLogin = useCallback(() => {
    if (redirectingRef.current) return;
    redirectingRef.current = true;
    setRedirecting(true);
    const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (window.location.pathname === '/login' || window.location.pathname.startsWith('/auth')) return;
    router.replace(`/login?returnTo=${encodeURIComponent(safeReturnTo(current))}`);
  }, [router]);
  useEffect(() => {
    if (status === 'guest') redirectToLogin();
    if (status === 'authorized') resetAuthRequiredNotification();
  }, [status, redirectToLogin]);
  if (status === 'checking') return <WorkspaceLoading />;
  if (redirecting || status === 'guest') return <GateMessage>登录已失效，正在跳转登录页…</GateMessage>;
  if (status === 'error') return <GateMessage><p>暂时无法检查登录状态，请重试。</p><button onClick={refresh} type="button">重新检查</button></GateMessage>;
  return <>{children}</>;
}
