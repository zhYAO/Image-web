"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState, type ReactNode } from "react";

// Imported by filename. No React Bits catalogue or animation runtime enters the hero bundle.
const FadeContentEffect = dynamic(
  () =>
    import("@/features/brand/react-bits/FadeContent").then(
      (module) => module.FadeContentEffect,
    ),
  { ssr: false },
);

export function Reveal({
  children,
  className = "",
  delay = 0,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [nearViewport, setNearViewport] = useState(false);
  useEffect(() => {
    if (!host.current || !("IntersectionObserver" in window)) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (Boolean(entry?.isIntersecting)) {
          setNearViewport(true);
          observer.disconnect();
        }
      },
      { rootMargin: "240px" },
    );
    observer.observe(host.current);
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={host} className={className}>
      {children}
      {nearViewport && (
        <FadeContentEffect
          targetRef={host}
          duration={900}
          distance={28}
          delay={delay}
          threshold={0.12}
          rootMargin="0px 0px -8% 0px"
          ease="cubic-bezier(.22,1,.36,1)"
        />
      )}
    </div>
  );
}
