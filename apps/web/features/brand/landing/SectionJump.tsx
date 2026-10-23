"use client";

import type { ButtonHTMLAttributes } from "react";

export function scrollToSection(id: string) {
  document.getElementById(id)?.scrollIntoView({
    behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ? "instant"
      : "smooth",
    block: "start",
  });
}
export function SectionJump({
  target,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { target: string }) {
  return (
    <button type="button" {...props} onClick={() => scrollToSection(target)}>
      {children}
    </button>
  );
}
