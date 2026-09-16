"use client";

import { CreditAccount } from "@/features/credits/CreditsProvider";
import { WebPageShell } from "@/features/shell/WebPageShell";

import type { Account } from "../../../../packages/domain/src/auth-contracts";
import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { notifyAuthChange } from "@/features/auth/AuthStatusProvider";

export function AccountPanel({ account }: { account: Account }) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);

  function redirectIfExpired(response: Response) {
    if (response.status !== 401) return false;
    router.replace(`/login?returnTo=${encodeURIComponent('/account')}`);
    return true;
  }

  async function runAction(action: () => Promise<void>) {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    setMessage('');
    try {
      await action();
    } catch {
      setMessage('网络连接失败，请稍后重试。');
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }

  function patch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void runAction(async () => {
      const response = await fetch('/api/account', {
        method: 'PATCH', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ displayName: String(data.get('displayName')) }),
      });
      if (!redirectIfExpired(response)) setMessage(response.ok ? '已保存。' : '保存失败。');
    });
  }

  function password(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void runAction(async () => {
      const response = await fetch("/api/auth/password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          password: data.get("password"),
          recovery: false,
        }),
      });
      if (redirectIfExpired(response)) return;
      const result = (await response.json()) as { updated?: boolean };
      setMessage(
        response.ok && result.updated === true
          ? "密码已更新，其他设备已退出。"
          : "密码更新失败。",
      );
    });
  }

  function logout() {
    void runAction(async () => {
      const response = await fetch('/api/auth/logout', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
      });
      if (response.ok) { notifyAuthChange(false); router.push('/login'); }
      else if (!redirectIfExpired(response)) setMessage('退出失败，请稍后重试。');
    });
  }

  function remove(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      pendingRef.current ||
      !confirm("注销后会立即停止访问，后台将永久删除账号数据。确认继续？")
    )
      return;
    const data = new FormData(event.currentTarget);
    void runAction(async () => {
      const response = await fetch("/api/account", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          password: data.get("password"),
          confirmation: "DELETE",
        }),
      });
      if (redirectIfExpired(response)) return;
      const result = (await response.json()) as { accepted?: boolean };
      setMessage(
        response.ok && result.accepted === true
          ? "注销申请已受理，数据正在清理。"
          : "密码验证失败，注销未受理。",
      );
    });
  }

  return (
    <WebPageShell>
      <section aria-busy={pending} className="glass-card glass-form">
        <a href="/">返回工作区</a>
        <p className="glass-kicker">ZIMAGE · 账号中心</p>
        <h1>账号</h1>
        <CreditAccount />
        <p className="glass-muted">邮箱：{account.email}</p>
        <form onSubmit={patch}><label>显示名称<input defaultValue={account.displayName ?? ''} name="displayName" /></label><button disabled={pending} type="submit">保存资料</button></form>
        <form onSubmit={password}><label>新密码<input autoComplete="new-password" name="password" required type="password" /></label><button disabled={pending} type="submit">修改密码</button></form>
        {message && (
          <p className="glass-status" role="status">
            {message}
          </p>
        )}
        <button className="glass-primary" disabled={pending} onClick={logout} type="button">退出登录</button>
        <form onSubmit={remove}><h2>注销账号</h2><p className="glass-muted">注销受理后，账号会立即停止访问；后台清理完成前状态为“删除中”。</p><label>重新输入密码<input autoComplete="current-password" name="password" required type="password" /></label><button className="glass-danger" disabled={pending} type="submit">永久注销账号</button></form>
      </section>
    </WebPageShell>
  );
}
