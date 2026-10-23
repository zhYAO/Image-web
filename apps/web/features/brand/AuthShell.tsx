"use client";

import Link from "next/link";
import { useEffect, useRef, type ReactNode } from "react";
import { ArrowRight } from "lucide-react";
import { BrandMark } from "./BrandMark";
import { Glass } from "./Glass";
import "./identity.css";

/** Source visual shell. Authentication forms and services remain product-owned. */
export function AuthShell({ children }: { children: ReactNode }) {
  const screen = useRef<HTMLElement>(null);
  useEffect(() => {
    const viewport = window.visualViewport;
    const sync = () => {
      screen.current?.style.setProperty(
        "--zi-viewport-height",
        `${viewport?.height ?? window.innerHeight}px`,
      );
      screen.current?.style.setProperty(
        "--zi-viewport-top",
        `${viewport?.offsetTop ?? 0}px`,
      );
    };
    sync();
    viewport?.addEventListener("resize", sync);
    viewport?.addEventListener("scroll", sync);
    window.addEventListener("resize", sync);
    return () => {
      viewport?.removeEventListener("resize", sync);
      viewport?.removeEventListener("scroll", sync);
      window.removeEventListener("resize", sync);
    };
  }, []);
  return (
    <main
      ref={screen}
      className="zi-identity zi-auth-screen"
      aria-label="ZImage 账号访问"
    >
      <div className="zi-auth-layout">
        <aside className="zi-auth-visual" aria-label="ZImage 创作空间">
          <div className="zi-auth-story">
            <span className="zi-eyebrow">IMAGINATION, IN FOCUS.</span>
            <h2>
              让每个灵感，
              <br />
              都有好画面。
            </h2>
            <p>
              从第一句想法，到下一张作品。
              <br />
              让创作，在这里自然发生。
            </p>
          </div>
          <div className="zi-auth-orbit" aria-hidden="true">
            <div className="zi-orbit-ring" />
            <div className="zi-orbit-ring zi-orbit-ring-second" />
            <Glass className="zi-glass-frame zi-glass-frame-back" />
            <Glass className="zi-glass-frame zi-glass-frame-front">
              <BrandMark />
            </Glass>
            <span className="zi-orbit-dot" />
          </div>
          <div className="zi-visual-foot">
            <span>ZIMAGE</span>
            <span>让想象，清晰可见。</span>
          </div>
        </aside>
        <div className="zi-auth-panel">
          <div className="zi-auth-reveal">
            <Glass as="section" className="zi-auth-card">
              <div
                className="zi-auth-scroll"
                role="region"
                tabIndex={0}
                aria-label="登录与账号操作"
              >
                <Link href="/home" className="zi-brand">
                  <BrandMark />
                  <span>ZImage</span>
                </Link>
                {children}
                <p className="zi-auth-footnote">
                  <Link href="/create">先探索一下电商创作</Link>
                  <ArrowRight />
                </p>
                <footer className="zi-footer">
                  <Link href="/" className="zi-back">
                    进入工作区
                    <ArrowRight />
                  </Link>
                  <nav aria-label="法律信息">
                    <Link href="/terms">服务条款</Link>
                    <Link href="/privacy">隐私政策</Link>
                  </nav>
                </footer>
              </div>
            </Glass>
          </div>
        </div>
      </div>
    </main>
  );
}
