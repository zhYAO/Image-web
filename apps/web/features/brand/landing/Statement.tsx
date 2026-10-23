"use client";

import { useEffect, useRef, useState } from "react";
import { statementOpacity } from "./motion";

const words = [
  "创作的起点，",
  "可以很简单。",
  "把想法说出来，",
  "让画面接着说。",
];
export function Statement() {
  const host = useRef<HTMLElement>(null);
  const [opacities, setOpacities] = useState<number[]>(() =>
    words.map(() => 1),
  );
  useEffect(() => {
    const preference = window.matchMedia(
      "(prefers-reduced-motion: reduce), (prefers-contrast: more), (forced-colors: active)",
    );
    let frame = 0;
    let visible = true;
    const update = () => {
      frame = 0;
      if (host.current && !document.hidden && (visible || preference.matches))
        setOpacities(
          preference.matches
            ? words.map(() => 1)
            : statementOpacity(
                host.current.getBoundingClientRect().top,
                window.innerHeight,
                words.length,
              ),
        );
    };
    const schedule = () => {
      if (!frame && !document.hidden) frame = requestAnimationFrame(update);
    };
    const scroll = () => {
      if (visible) schedule();
    };
    const visibility = () => {
      if (document.hidden) {
        cancelAnimationFrame(frame);
        frame = 0;
      } else schedule();
    };
    let observer: IntersectionObserver | undefined;
    if (host.current && "IntersectionObserver" in window) {
      observer = new IntersectionObserver(
        ([entry]) => {
          visible = Boolean(entry?.isIntersecting);
          if (visible) schedule();
        },
        { rootMargin: "200px" },
      );
      observer.observe(host.current);
    }
    window.addEventListener("scroll", scroll, { passive: true });
    window.addEventListener("resize", schedule, { passive: true });
    preference.addEventListener("change", schedule);
    document.addEventListener("visibilitychange", visibility);
    update();
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("scroll", scroll);
      window.removeEventListener("resize", schedule);
      preference.removeEventListener("change", schedule);
    };
  }, []);
  return (
    <section
      ref={host}
      className="zl-statement zl-container"
      aria-labelledby="landing-statement-title"
    >
      <span className="zl-eyebrow">LESS FRICTION. MORE IMAGINATION.</span>
      <h2 id="landing-statement-title">
        {words.map((word, index) => (
          <span
            key={word}
            data-statement-word
            style={{ opacity: opacities[index] }}
          >
            {word}
          </span>
        ))}
      </h2>
      <p>
        无需在复杂工具之间来回切换。
        <br />
        聊想法、搭场景、做套图，在一个连贯的空间里完成。
      </p>
    </section>
  );
}
