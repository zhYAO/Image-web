"use client";

import Link from "next/link";
import {
  Box,
  Copy,
  Grid2X2,
  History,
  Images,
  Layers3,
  ListOrdered,
  Plus,
  Sparkles,
  Shirt,
  UserRound,
} from "lucide-react";
import type { CommerceScene } from "@zimage/domain";
import { CreditBalance } from "@/features/credits/CreditsProvider";
import { useAuthStatus } from "@/features/auth/AuthStatusProvider";
import { useWorkspaceStore } from "@/store/workspace-store";
import styles from "./meitu.module.css";

export function CommerceHeader({ onHistory }: { onHistory?: () => void }) {
  const { status } = useAuthStatus();
  return (
    <header className={styles.header}>
      <Link className={styles.brand} href="/create">
        <Sparkles size={23} />
        ZImage
      </Link>
      <Link href="/create">
        <Plus size={15} />
        新建任务
      </Link>
      <Link href="/create/batch">
        <Layers3 size={15} />
        批量生成
      </Link>
      <span className={styles.headerSpacer} />
      <CreditBalance />
      {onHistory ? (
        <button onClick={onHistory}>
          <History size={16} />
          生成记录
        </button>
      ) : (
        <Link
          href="/"
          onClick={() =>
            useWorkspaceStore.getState().setSessionDrawerOpen(true)
          }
        >
          <History size={16} />
          生成记录
        </Link>
      )}
      <Link
        href={status === "guest" ? "/login?returnTo=%2Fcreate" : "/account"}
      >
        <UserRound size={16} />
        {status === "guest" ? "登录" : "账号"}
      </Link>
    </header>
  );
}
const links = [
  { id: "apparel-catalog", href: "/create/apparel-catalog", title: "服装商品图片", Icon: Shirt },
  { id: undefined, href: "/create", title: "工具目录", Icon: Grid2X2 },
  {
    id: "product-set",
    href: "/create/product-set",
    title: "商品套图",
    Icon: Images,
  },
  { id: "detail", href: "/create/detail", title: "详情页", Icon: ListOrdered },
  { id: "clone", href: "/create/clone", title: "爆款复刻", Icon: Copy },
  { id: "batch", href: "/create/batch", title: "批量生成", Icon: Layers3 },
  {
    id: "product-main",
    href: "/create/product-main",
    title: "AI商品图",
    Icon: Box,
  },
];
export function CommerceNav({ scene }: { scene?: CommerceScene }) {
  return (
    <aside className={styles.nav} aria-label="电商工具导航">
      {links.map(({ id, href, title, Icon }) => (
        <Link
          key={href}
          href={href}
          aria-current={scene === id ? "page" : undefined}
        >
          <Icon aria-hidden />
          <span>{title}</span>
        </Link>
      ))}
      <Link className={styles.navFooter} href="/">
        <Sparkles />
        <span>普通创作</span>
      </Link>
    </aside>
  );
}
