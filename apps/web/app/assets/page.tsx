"use client";
import Link from "next/link";
import { useAuthStatus } from "@/features/auth/AuthStatusProvider";
import { catalogueRuntimeAllowed } from "@/features/workspace/catalogue-runtime";
import { WebPageShell } from "@/features/shell/WebPageShell";
export default function AssetsPage() {
  const { status, refresh } = useAuthStatus();
  if (catalogueRuntimeAllowed(status)) return null;
  return (
    <WebPageShell>
      <section className="glass-card glass-form">
        <h1>资产库</h1>
        {status === "checking" ? (
          <p role="status">正在确认账号…</p>
        ) : status === "error" ? (
          <p role="alert">
            身份状态暂不可用 <button onClick={refresh}>重试</button>
          </p>
        ) : (
          <>
            <p>登录后查看自己的会话作品。</p>
            <Link href="/login?returnTo=%2Fassets">登录并查看作品</Link>
          </>
        )}
      </section>
    </WebPageShell>
  );
}
