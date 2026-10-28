"use client";

import type { ReactNode } from "react";
import FadeContent from "@/features/brand/react-bits/FadeContent";

/** The same component owns the host ref and its layout preparation. */
export function Reveal({ children, className = "", delay = 0 }: {
  children: ReactNode; className?: string; delay?: number;
}) {
  return <FadeContent className={className} duration={900} distance={28} delay={delay}
    threshold={0.12} rootMargin="0px 0px -8% 0px" ease="cubic-bezier(.22,1,.36,1)">
    {children}
  </FadeContent>;
}
