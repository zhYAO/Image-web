import { useCallback, useEffect, useRef, useState } from 'react';
import { useRuntime } from './runtime-provider';
import { loadTurnstileScript } from './script-loader';
import styles from '../../../web/features/auth/auth-captcha.module.css';

type Status = 'loading' | 'pending' | 'success' | 'expired' | 'failed' | 'script-failed';
const text: Record<Status, string> = {
  loading: '正在加载安全验证…', pending: '请完成安全验证后提交。', success: '安全验证已通过',
  expired: '安全验证已过期，请重新验证。', failed: '安全验证未完成，请重试。',
  'script-failed': '安全验证加载失败，请检查网络后重试。',
};
function Challenge({ siteKey, onToken, onRetry }: { siteKey: string; onToken: (token?: string) => void; onRetry: () => void }) {
  const container = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<Status>('loading');
  useEffect(() => {
    let alive = true;
    let widget: string | undefined;
    const fail = (status: Status) => { if (alive) { onToken(undefined); setStatus(status); } };
    void loadTurnstileScript().then(() => {
      if (!alive) return;
      if (!window.turnstile || !container.current) { fail('failed'); return; }
      try {
        setStatus('pending');
        widget = window.turnstile.render(container.current, {
          sitekey: siteKey, theme: 'light', size: 'flexible',
          callback(token) { if (alive) { onToken(token || undefined); setStatus(token ? 'success' : 'failed'); } },
          'error-callback': () => fail('failed'), 'expired-callback': () => fail('expired'),
        });
      } catch { fail('failed'); }
    }).catch(() => fail('script-failed'));
    return () => { alive = false; if (widget !== undefined) window.turnstile?.remove(widget); };
  }, [siteKey, onToken]);
  const failed = status === 'expired' || status === 'failed' || status === 'script-failed';
  return <div aria-label="安全验证" className={styles.challenge} data-status={status}>
    <div className={styles.widget} ref={container} aria-busy={status === 'loading'} />
    <div className={styles.feedback}><p className={styles.status} role={failed ? 'alert' : 'status'}>{text[status]}</p>
      {failed && <button className={styles.retry} type="button" onClick={onRetry}>重新验证</button>}
    </div>
  </div>;
}
export function useAuthCaptcha() {
  const runtime = useRuntime();
  const siteKey = runtime.status === 'ready' ? runtime.value.config.captchaSiteKey : null;
  const [captchaToken, setCaptchaToken] = useState<string>();
  const [attempt, setAttempt] = useState(0);
  const resetCaptcha = useCallback(() => { setCaptchaToken(undefined); setAttempt(value => value + 1); }, []);
  return { captchaToken, captchaPending: runtime.status !== 'ready' || Boolean(siteKey && !captchaToken), resetCaptcha,
    captcha: siteKey ? <Challenge key={`${siteKey}:${attempt}`} siteKey={siteKey} onToken={setCaptchaToken} onRetry={resetCaptcha} /> : null };
}
