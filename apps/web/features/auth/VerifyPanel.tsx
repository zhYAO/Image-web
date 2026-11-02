'use client';

import { AuthShell } from '@/features/brand/AuthShell';

import { useSearchParams } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { authFeedback } from './feedback';
import { safeReturnTo } from './return-to';
import { useAuthCaptcha } from './use-auth-captcha';

export function VerifyPanel() {
  const params = useSearchParams();
  const [email, setEmail] = useState(params.get('email') ?? '');
  const [message, setMessage] = useState('');
  const [failed, setFailed] = useState(false);
  const [pending, setPending] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const { captcha, captchaToken, captchaPending, resetCaptcha } = useAuthCaptcha();
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const data = new FormData(event.currentTarget);
    setPending(true); setMessage(''); setFailed(false);
    try {
      const response = await fetch('/api/auth/verify', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, token: data.get('token'), returnTo: params.get('returnTo') ?? undefined }),
      });
      const result = await response.json() as { returnTo?: string; message?: string };
      if (response.ok) location.assign(safeReturnTo(result.returnTo));
      else { setFailed(true); setMessage(authFeedback(result, '验证码无效或已过期，请重新申请。')); }
    } catch { setFailed(true); setMessage('网络连接失败，请检查网络后重试。'); }
    finally { setPending(false); }
  }

  async function resend() {
    if (pending || cooldown > 0 || captchaPending) return;
    setPending(true); setMessage(''); setFailed(false);
    try {
      const response = await fetch('/api/auth/resend', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, captchaToken }),
      });
      const result = await response.json() as { accepted?: boolean; message?: string };
      if (response.ok && result.accepted === true) {
        setMessage('如果该邮箱正在等待验证，你将收到新验证码。请检查收件箱和垃圾邮件。');
        setCooldown(60);
      } else {
        setFailed(true); setMessage(authFeedback(result, '验证码暂时无法发送，请稍后重试。'));
        if (response.status === 429) setCooldown(60);
      }
    } catch { setFailed(true); setMessage('网络连接失败，请检查网络后重试。'); }
    finally { setPending(false); resetCaptcha(); }
  }

  return <AuthShell><section className="zi-auth-content">
    <p className="zi-eyebrow">账号验证</p><div className="zi-auth-heading"><h1 id="zi-auth-title">验证邮箱</h1>
    <p>请手动输入邮件中的 6 位验证码继续。</p></div>
    <form className="zi-auth-form" onSubmit={submit}>
      <label className="zi-field">邮箱<input autoComplete="email" name="email" onChange={(event) => setEmail(event.target.value)} required type="email" value={email} /></label>
      <label className="zi-field">验证码<input autoComplete="one-time-code" inputMode="numeric" maxLength={6} name="token" pattern="[0-9]{6}" required /></label>
      {message && <p className={failed ? 'zi-feedback' : 'zi-register-note'} role={failed ? 'alert' : 'status'}>{message}</p>}
      <button className="zi-button zi-primary zi-auth-submit" disabled={pending} type="submit">继续验证</button>
      {captcha}
      <button className="zi-button zi-secondary zi-auth-submit" disabled={pending || cooldown > 0 || captchaPending || !email.trim()} onClick={resend} type="button">{cooldown > 0 ? `${cooldown} 秒后可重发` : '重新发送验证码'}</button>
    </form><a className="zi-auth-return" href="/login">返回登录</a>
  </section></AuthShell>;
}
