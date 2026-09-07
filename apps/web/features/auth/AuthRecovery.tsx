'use client';

import { useState, type FormEvent } from 'react';

import type { Account } from '../../../../packages/domain/src/auth-contracts';

export interface AuthRecoveryProps {
  authenticate?: (credentials: { email: string; password: string }) => Promise<Account>;
  onAuthenticated(account: Account): void;
  onClose?(): void;
  open: boolean;
}

async function defaultAuthenticate(credentials: { email: string; password: string }): Promise<Account> {
  const login = await fetch('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(credentials) });
  if (!login.ok) throw new Error('login_failed');
  const response = await fetch('/api/account', { cache: 'no-store' });
  if (!response.ok) throw new Error('account_failed');
  return response.json() as Promise<Account>;
}

export function AuthRecovery({ authenticate = defaultAuthenticate, onAuthenticated, onClose, open }: AuthRecoveryProps) {
  const [error, setError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError('');
    const data = new FormData(event.currentTarget);
    try {
      onAuthenticated(await authenticate({ email: String(data.get('email')), password: String(data.get('password')) }));
    } catch { setError('邮箱或密码不正确，请重试。'); }
  }
  return <section aria-modal="true" data-testid="auth-recovery" hidden={!open} role="dialog">
    <h2>登录后继续</h2>
    <p>草稿会留在当前页面。登录后将刷新你的账号内容。</p>
    <form onSubmit={submit}>
      <label>邮箱<input autoComplete="email" name="email" required type="email" /></label>
      <label>密码<input autoComplete="current-password" name="password" required type="password" /></label>
      {error && <p role="alert">{error}</p>}
      <button type="submit">登录并返回</button>
      {onClose && <button onClick={onClose} type="button">暂不登录</button>}
    </form>
  </section>;
}
