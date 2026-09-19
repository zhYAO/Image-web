'use client';

import Script from 'next/script';
import { useCallback, useEffect, useRef, useState } from 'react';
import styles from './auth-captcha.module.css';

type CaptchaStatus = 'loading' | 'pending' | 'success' | 'expired' | 'failed' | 'script-failed';

const statusText: Record<CaptchaStatus, string> = {
  loading: '正在加载安全验证…',
  pending: '请完成安全验证后提交。',
  success: '安全验证已通过',
  expired: '安全验证已过期，请重新验证。',
  failed: '安全验证未完成，请重试。',
  'script-failed': '安全验证加载失败，请检查网络后刷新页面。',
};

function CaptchaChallenge({ siteKey, onToken, onRetry }: { siteKey: string; onToken: (token: string | undefined) => void; onRetry: () => void }) {
  const container = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState<CaptchaStatus>('loading');
  useEffect(() => {
    const api = window.turnstile;
    if (!ready) return;
    let active = true;
    let widget: string | undefined;
    const fail = (reason: 'failed' | 'expired' = 'failed') => { if (active) { onToken(undefined); setStatus(reason); } };
    try {
      if (!api || !container.current) throw new Error('captcha_unavailable');
      widget = api.render(container.current, {
        sitekey: siteKey, theme: 'light', size: 'flexible',
        callback: (token) => { if (active) { onToken(token || undefined); setStatus(token ? 'success' : 'failed'); } },
        'error-callback': () => fail(),
        'expired-callback': () => fail('expired'),
      });
    } catch { queueMicrotask(() => fail()); }
    return () => { active = false; if (widget !== undefined) api?.remove(widget); };
  }, [ready, siteKey, onToken]);
  const failed = status === 'expired' || status === 'failed' || status === 'script-failed';
  return <div aria-label="安全验证" className={styles.challenge} data-status={status}>
    <Script id="zimage-turnstile" src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" strategy="afterInteractive" onReady={() => { setReady(true); setStatus('pending'); }} onError={() => { onToken(undefined); setStatus('script-failed'); }} />
    <div className={styles.widget} ref={container} aria-busy={status === 'loading'} />
    <div className={styles.feedback}>
      <p className={styles.status} role={failed ? 'alert' : 'status'}>{statusText[status]}</p>
      {failed && <button className={styles.retry} type="button" onClick={status === 'script-failed' ? () => window.location.reload() : onRetry}>{status === 'script-failed' ? '刷新页面' : '重新验证'}</button>}
    </div>
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
