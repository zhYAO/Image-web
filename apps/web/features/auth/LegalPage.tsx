import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { BrandMark } from "@/features/brand/BrandMark";
import { Glass } from "@/features/brand/Glass";
import "@/features/brand/identity.css";

/** Unapproved legal draft: presentation cannot authorize registration. */
export function LegalPage({
  kind,
  creditBalance,
}: {
  kind: "terms" | "privacy";
  creditBalance?: ReactNode;
}) {
  const title = kind === "terms" ? "服务条款" : "隐私政策";
  return (
    <main className="zi-identity zi-legal">
      <nav className="zi-topline" aria-label="网站导航">
        <Link href="/" className="zi-brand">
          <BrandMark />
          ZImage
        </Link>
        <Link href="/login" className="zi-back">
          <ArrowLeft />
          返回登录
        </Link>
        {creditBalance}
      </nav>
      <header>
        <span className="zi-eyebrow">未批准草案</span>
        <h1>{title}（未批准草案）</h1>
        <p>服务条款与隐私政策正在修订中。</p>
      </header>
      <Glass as="article" className="zi-account-card">
        <span className="zi-eyebrow">未批准草案 · 不构成正式协议</span>
        <h2>{title}草案</h2>
        <p>
          本文本尚未经过正式审批，仅用于隔离开发与测试，不能作为公开发布版本。
        </p>
        {kind === "terms" ? (
          <p>
            拟议范围：中国大陆公开
            Beta，产品尚未达到生产就绪；切换正式账号后匿名数据将无通知永久删除；账号注销会立即停止访问并进入后台清理。
          </p>
        ) : (
          <p>
            拟议范围：邮箱账号资料、创作会话与生成资产；日志不得记录邮箱、密码、令牌或完整提示词。切换正式账号时匿名内容会永久删除。
          </p>
        )}
        <p>注册功能将在法律条款确认后开放。</p>
        <Link href="/login" className="zi-button zi-secondary">
          返回登录
        </Link>
      </Glass>
    </main>
  );
}
