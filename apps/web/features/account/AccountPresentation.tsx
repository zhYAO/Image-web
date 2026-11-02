"use client";

import Link from "next/link";
import {
  Archive,
  ArrowLeft,
  ArrowRight,
  SlidersHorizontal,
  UserRound,
} from "lucide-react";
import type { FormEvent } from "react";
import type { Account } from "@zimage/domain";
import { CreditAccount } from "@/features/credits/CreditsProvider";
import { Glass } from "@/features/brand/Glass";

type Props = {
  account: Account;
  pending: boolean;
  message: string;
  patch: (event: FormEvent<HTMLFormElement>) => void;
  password: (event: FormEvent<HTMLFormElement>) => void;
  remove: (event: FormEvent<HTMLFormElement>) => void;
  logout: () => void;
};

/** Shared presentation only: each runtime retains its existing account actions. */
export function AccountPresentation({
  account,
  pending,
  message,
  patch,
  password,
  remove,
  logout,
}: Props) {
  return (
    <>
      <nav className="zi-topline" aria-label="账号导航">
        <Link href="/workspace" className="zi-back">
          <ArrowLeft />
          <span>返回工作区</span>
        </Link>
        <span className="zi-eyebrow">YOUR CREATIVE SPACE</span>
      </nav>
      <header className="zi-account-hero">
        <div className="zi-account-identity">
          <div className="zi-profile-avatar" aria-hidden="true">
            <UserRound />
          </div>
          <div>
            <span className="zi-eyebrow">我的账号</span>
            <h1>{account.displayName || "账号"}</h1>
            <p>整理资料，专注下一次创作。</p>
          </div>
        </div>
        <nav className="zi-account-shortcuts" aria-label="创作快捷入口">
          <Link href="/assets" className="zi-button zi-secondary">
            <Archive />
            <span>资产库</span>
          </Link>
          <Link href="/workspace" className="zi-button zi-primary">
            <span>开始创作</span>
            <ArrowRight />
          </Link>
        </nav>
      </header>
      <div className="zi-account-grid">
        <div className="zi-account-main">
          <CreditAccount />
        </div>
        <div className="zi-account-settings">
          <Glass as="section" className="zi-account-card">
            <div className="zi-card-heading">
              <h2>基本资料</h2>
              <UserRound />
            </div>
            <p className="zi-account-email">邮箱：{account.email}</p>
            <form onSubmit={patch}>
              <label className="zi-field">
                显示名称
                <input
                  defaultValue={account.displayName ?? ""}
                  name="displayName"
                  autoComplete="nickname"
                />
              </label>
              <button
                className="zi-button zi-primary"
                disabled={pending}
                type="submit"
              >
                保存资料
              </button>
            </form>
          </Glass>
          <Glass as="section" className="zi-account-card">
            <div className="zi-card-heading">
              <h2>账号安全</h2>
              <SlidersHorizontal />
            </div>
            <p className="zi-settings-intro">
              管理登录密码，保护你的创作资料。
            </p>
            <form onSubmit={password}>
              <label className="zi-field">
                新密码
                <input
                  autoComplete="new-password"
                  name="password"
                  required
                  type="password"
                />
              </label>
              <button
                className="zi-button zi-primary"
                disabled={pending}
                type="submit"
              >
                修改密码
              </button>
            </form>
          </Glass>
          {message && (
            <p className="zi-register-note" role="status">
              {message}
            </p>
          )}
          <div className="zi-account-session">
            <button
              className="zi-button zi-secondary"
              disabled={pending}
              onClick={logout}
              type="button"
            >
              <ArrowRight />
              <span>退出登录</span>
            </button>
            <Glass as="section" className="zi-account-card zi-danger-zone">
              <form onSubmit={remove}>
                <h2>注销账号</h2>
                <p>
                  注销申请后账号会立即停止访问；后台清理完成前状态为“删除中”。
                </p>
                <label className="zi-field">
                  再次输入密码
                  <input aria-label="重新输入密码"
                    autoComplete="current-password"
                    name="password"
                    required
                    type="password"
                  />
                </label>
                <button
                  className="zi-button zi-secondary"
                  disabled={pending}
                  type="submit"
                >
                  申请注销账号
                </button>
              </form>
            </Glass>
          </div>
        </div>
      </div>
    </>
  );
}
