'use client';

import Script from 'next/script';
import { useCallback, useEffect, useRef, useState } from 'react';

function CaptchaChallenge({ siteKey, onToken, onRetry }: { siteKey: string; onToken: (token: string | undefined) => void; onRetry: () => void }) {
  const container = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [scriptFailed, setScriptFailed] = useState(false);
  useEffect(() => {
    const api = window.turnstile;
    if (!ready || !api || !container.current) return;
    let active = true;
    let widget: string | undefined;
    const fail = () => { if (active) { onToken(undefined); setFailed(true); } };
    try {
      widget = api.render(container.current, {
        sitekey: siteKey, theme: 'auto',
        callback: (token) => { if (active) { onToken(token); setFailed(false); } },
        'error-callback': fail,
        'expired-callback': fail,
      });
    } catch { queueMicrotask(fail); }
    return () => { active = false; if (widget !== undefined) api.remove(widget); };
  }, [ready, siteKey, onToken]);
  return <div aria-label="安全验证">
    <Script id="zimage-turnstile" src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" strategy="afterInteractive" onReady={() => setReady(true)} onError={() => { onToken(undefined); setScriptFailed(true); }} />
    <div ref={container} />
    {scriptFailed ? <p role="alert">安全验证加载失败，请检查网络后<button type="button" onClick={() => window.location.reload()}>刷新页面</button>。</p>
      : failed ? <p role="alert">安全验证未完成或已过期。<button type="button" onClick={onRetry}>重新验证</button></p>
      : <p className="glass-muted">请完成安全验证后提交。</p>}
  </div>;
}

export function useAuthCaptcha() {
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim();
  const [captchaToken, setCaptchaToken] = useState<string>();
  const [attempt, setAttempt] = useState(0);
  const resetCaptcha = useCallback(() => { setCaptchaToken(undefined); setAttempt((value) => value + 1); }, []);
  return {
    captchaToken,
    captchaPending: Boolean(siteKey && !captchaToken),
    resetCaptcha,
    captcha: siteKey ? <CaptchaChallenge key={attempt} siteKey={siteKey} onToken={setCaptchaToken} onRetry={resetCaptcha} /> : null,
  };
}
