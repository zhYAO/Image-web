"use client";

import { CreditAccount } from "@/features/credits/CreditsProvider";
import { AccountFrame } from "./AccountFrame";
import { ActionButton, ContentDialog } from "@/features/controls/NativeControls";

import '@/features/brand/identity.css';

import type { Account } from "../../../../packages/domain/src/auth-contracts";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { notifyAuthChange, useAuthStatus } from "@/features/auth/AuthStatusProvider";

export function AccountPanel({ account }: { account: Account }) {
  const router = useRouter();
  const { status: identityStatus, ownerId, refresh: refreshIdentity } = useAuthStatus();
  const formalAuth = process.env.NEXT_PUBLIC_PHASE2_AUTH === 'true';
  const guest = formalAuth && identityStatus === 'guest';
  const mismatchedOwner = formalAuth && identityStatus === 'authorized' && ownerId !== account.id;
  useEffect(() => {
    if (guest) router.replace('/home');
    else if (mismatchedOwner) router.refresh();
  }, [guest, mismatchedOwner, ownerId, account.id, router]);
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const [deleteOwner, setDeleteOwner] = useState<string>();
  const deletionPassword = useRef<string | undefined>(undefined);
  useEffect(() => () => {
    deletionPassword.current = undefined;
  }, [account.id, ownerId, identityStatus]);

  async function redirectIfExpired(response: Response) {
    if (response.status !== 401) return false;
    // Action failures (including provider signOut failures) historically share
    // 401. Only the dedicated identity check can confirm a guest transition.
    try {
      const identity = await fetch('/api/auth/session', { cache: 'no-store', signal: AbortSignal.timeout(15000) });
      if (identity.status !== 401) return false;
    } catch {
      return false;
    }
    notifyAuthChange(false);
    router.replace('/home');
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
      if (!await redirectIfExpired(response)) setMessage(response.ok ? '已保存。' : '保存失败。');
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
      if (await redirectIfExpired(response)) return;
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
      const result = response.ok ? await response.json().catch(() => null) : null;
      if (response.ok && result?.signedOut === true) { notifyAuthChange(false); router.replace('/home'); }
      else if (!await redirectIfExpired(response)) setMessage('退出失败，请稍后重试。');
    });
  }

  function remove(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pendingRef.current) return;
    deletionPassword.current = String(new FormData(event.currentTarget).get("password") ?? "");
    setDeleteOwner(account.id);
  }

  function closeDelete() {
    if (pendingRef.current) return;
    deletionPassword.current = undefined;
    setDeleteOwner(undefined);
  }

  function confirmDelete() {
    if (pendingRef.current || deletionPassword.current === undefined || deleteOwner !== account.id) return;
    const password = deletionPassword.current;
    void runAction(async () => {
      const response = await fetch("/api/account", {
        method: "DELETE", headers: { "content-type": "application/json" },
        body: JSON.stringify({ password, confirmation: "DELETE" }),
      });
      if (await redirectIfExpired(response)) return;
      const result = (await response.json()) as { accepted?: boolean };
      setMessage(response.ok && result.accepted === true
        ? "注销申请已受理，数据正在清理。"
        : "密码验证失败，注销未受理。");
    }).finally(() => {
      deletionPassword.current = undefined;
      setDeleteOwner(undefined);
    });
  }

  // Router back/forward can reuse authenticated SSR props. They are not proof
  // of the current owner after logout, an account switch or a failed check.
  if (formalAuth && (identityStatus !== 'authorized' || mismatchedOwner)) {
    return <main className="glass-page"><section className="glass-card glass-form">
      <p role="status">{guest ? '尚未登录，正在返回首页…' : identityStatus === 'error' ? '暂时无法检查登录状态，请重试。' : '正在确认账号…'}</p>
      {identityStatus === 'error' && <button type="button" onClick={refreshIdentity}>重新检查</button>}
      <a href="/home">返回首页</a>
    </section></main>;
  }

  return (
    <AccountFrame>
      <section aria-busy={pending} className="zi-account zi-identity">
        <ContentDialog open={deleteOwner === account.id} title="确认注销账号" onClose={closeDelete} footer={<>
          <ActionButton disabled={pending} onClick={closeDelete}>取消</ActionButton>
          <ActionButton danger busy={pending} onClick={confirmDelete}>确认注销</ActionButton>
        </>}>
          <p>注销将立即停止访问，后台将继续删除账号数据。确认后才会提交申请。</p>
        </ContentDialog>
        <header className="zi-account-hero"><div className="zi-account-identity"><div><p className="glass-kicker">YOUR CREATIVE SPACE</p><h1>账号</h1><p>管理个人资料、安全与创作积分。</p></div></div><a className="zi-button" href="/workspace">返回工作区</a></header>
        <div className="zi-account-grid"><div className="zi-account-main glass-card"><CreditAccount /></div><div className="zi-account-settings glass-form glass-card">
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
        </div></div>
      </section>
    </AccountFrame>
  );
}
