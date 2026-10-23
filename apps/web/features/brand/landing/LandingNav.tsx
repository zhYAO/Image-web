"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { PillNavCTA } from "./PillNavCTA";
import { Glass } from "@/features/brand/Glass";
import { BrandMark } from "./BrandMark";
import { nextCondensed } from "./motion";
import { scrollToSection } from "./SectionJump";

export function LandingNav() {
  const [condensed, setCondensed] = useState(false);
  const [open, setOpen] = useState(false);
  const headerRef = useRef<HTMLElement>(null);
  const menuRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      setCondensed((current) => nextCondensed(current, window.scrollY));
    };
    const scroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    const resize = () => {
      if (window.innerWidth > 880) setOpen(false);
      scroll();
    };
    const outside = (event: PointerEvent) => {
      if (!headerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (
        event.key === "Escape" &&
        menuRef.current?.getAttribute("aria-expanded") === "true"
      ) {
        setOpen(false);
        menuRef.current?.focus();
      }
    };
    window.addEventListener("scroll", scroll, { passive: true });
    window.addEventListener("resize", resize, { passive: true });
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    update();
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", scroll);
      window.removeEventListener("resize", resize);
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, []);

  const jump = (id: string) => {
    setOpen(false);
    scrollToSection(id);
  };
  return (
    <header
      ref={headerRef}
      className={`zl-chrome${condensed ? " is-condensed" : ""}`}
    >
      <Glass
        refract
        className={`zl-nav${open ? " is-open" : ""}`}
        aria-label="网站导航"
      >
        <Link href="/home" className="zl-brand" onClick={() => setOpen(false)}>
          <span className="zl-brand-icon">
            <BrandMark />
          </span>
          <span>ZImage</span>
        </Link>
        <nav
          className={`zl-nav-links${open ? " liquid-glass surface-white" : ""}`}
          id="landing-primary-nav"
          aria-label="主导航"
        >
          <button type="button" onClick={() => jump("landing-workflow")}>
            创作方式
          </button>
          <button type="button" onClick={() => jump("landing-scenes")}>
            电商场景
          </button>
          <Link href="/assets" onClick={() => setOpen(false)}>
            资产库
          </Link>
          <button type="button" onClick={() => jump("landing-faq")}>
            常见问题
          </button>
          <Link
            href="/login"
            className="zl-mobile-login"
            onClick={() => setOpen(false)}
          >
            登录
          </Link>
        </nav>
        <div className="zl-nav-actions">
          <Link
            href="/login"
            className="zl-login"
            onClick={() => setOpen(false)}
          >
            登录
          </Link>
          <PillNavCTA variant="nav" onClick={() => setOpen(false)} />
          <button
            ref={menuRef}
            type="button"
            className="zl-menu"
            aria-label={open ? "关闭导航" : "打开导航"}
            aria-controls="landing-primary-nav"
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
          >
            <span />
            <span />
          </button>
        </div>
      </Glass>
    </header>
  );
}
