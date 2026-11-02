'use client';

import { AuthShell } from '@/features/brand/AuthShell';

import { useState, type FormEvent } from 'react';
import { authFeedback } from './feedback';

export function ResetPasswordPanel() {
  const [message, setMessage] = useState('');
  const [failed, setFailed] = useState(false);
  const [pending, setPending] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const data = new FormData(event.currentTarget);
    setPending(true); setMessage(''); setFailed(false);
    try {
      const response = await fetch('/api/auth/recovery/verify', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: data.get('email'), token: data.get('token'), password: data.get('password') }),
      });
      const result = await response.json() as { updated?: boolean; reason?: string; message?: string };
      const success = response.ok && result.updated === true;
      setFailed(!success);
      setMessage(success ? '密码已重置。所有设备均已退出，请重新登录。' : authFeedback(result, '验证码无效、已过期或密码不符合要求。'));
    } catch { setFailed(true); setMessage('网络连接失败，请检查网络后重试。'); }
    finally { setPending(false); }
  }
  return <AuthShell><section className="zi-auth-content">
    <p className="zi-eyebrow">账号恢复</p><div className="zi-auth-heading"><h1 id="zi-auth-title">重置密码</h1>
    <p>打开此页面不会验证账号。请输入邮件中的 6 位验证码继续。</p></div>
    <form className="zi-auth-form" onSubmit={submit}>
      <label className="zi-field">邮箱<input autoComplete="email" name="email" required type="email" /></label>
      <label className="zi-field">验证码<input autoComplete="one-time-code" inputMode="numeric" maxLength={6} name="token" pattern="[0-9]{6}" required /></label>
      <label className="zi-field">新密码<input autoComplete="new-password" name="password" required type="password" /></label>
      <button className="zi-button zi-primary zi-auth-submit" disabled={pending} type="submit">设置新密码</button>
    </form>
    {message && <p className={failed ? 'zi-feedback' : 'zi-register-note'} role={failed ? 'alert' : 'status'}>{message}</p>}
    <a className="zi-auth-return" href="/login">返回登录</a>
  </section></AuthShell>;
}
