'use client';

import { useState, type FormEvent } from 'react';

import type { Account } from '../../../../packages/domain/src/auth-contracts';
import { authFeedback } from './feedback';
import { useAuthCaptcha } from './use-auth-captcha';

type Credentials = { email: string; password: string; captchaToken?: string };
class LoginFeedbackError extends Error {}

export interface AuthRecoveryProps {
  authenticate?: (credentials: Credentials) => Promise<Account>;
  onAuthenticated(account: Account): void;
  onClose?(): void;
  open: boolean;
}

async function defaultAuthenticate(credentials: Credentials): Promise<Account> {
  const login = await fetch('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(credentials) });
  if (!login.ok) throw new LoginFeedbackError(authFeedback(await login.json(), '邮箱或密码不正确，请重试。'));
  const response = await fetch('/api/account', { cache: 'no-store' });
  if (!response.ok) throw new Error('account_failed');
  return response.json() as Promise<Account>;
}

export function AuthRecovery(props: AuthRecoveryProps) {
  return <section aria-modal="true" data-testid="auth-recovery" hidden={!props.open} role="dialog">
    {props.open && <RecoveryForm {...props} />}
  </section>;
}

function RecoveryForm({ authenticate = defaultAuthenticate, onAuthenticated, onClose }: AuthRecoveryProps) {
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const { captcha, captchaToken, captchaPending, resetCaptcha } = useAuthCaptcha();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError('');
    if (pending || captchaPending) return;
    const data = new FormData(event.currentTarget);
    setPending(true);
    try {
      onAuthenticated(await authenticate({ email: String(data.get('email')), password: String(data.get('password')), captchaToken }));
    } catch (cause) { setError(cause instanceof LoginFeedbackError ? cause.message : '邮箱或密码不正确，请重试。'); }
    finally { setPending(false); resetCaptcha(); }
  }
  return <>
    <h2>登录后继续</h2>
    <p>草稿会留在当前页面。登录后将刷新你的账号内容。</p>
    <form onSubmit={submit}>
      <label>邮箱<input autoComplete="email" name="email" required type="email" /></label>
      <label>密码<input autoComplete="current-password" name="password" required type="password" /></label>
      {captcha}
      {error && <p role="alert">{error}</p>}
      <button disabled={pending || captchaPending} type="submit">登录并返回</button>
      {onClose && <button onClick={onClose} type="button">暂不登录</button>}
    </form>
  </>;
}
