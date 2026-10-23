"use client";

import { memo, useEffect, useRef, useState } from "react";
import styles from "./workspace.module.css";

// The decoration is a stable sibling; input DOM and IME handling remain untouched.
export const ComposerOrbs = memo(function ComposerOrbs({
  focused,
}: {
  focused: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [eligible, setEligible] = useState(false);

  useEffect(() => {
    const element = host.current;
    if (!element || !window.matchMedia || !("IntersectionObserver" in window))
      return;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const contrast = window.matchMedia("(forced-colors: active)");
    let visible = false;
    const update = () =>
      setEligible(
        visible && !document.hidden && !motion.matches && !contrast.matches,
      );
    const observer = new IntersectionObserver(([entry]) => {
      visible = Boolean(entry?.isIntersecting);
      update();
    });
    observer.observe(element);
    motion.addEventListener("change", update);
    contrast.addEventListener("change", update);
    document.addEventListener("visibilitychange", update);
    return () => {
      observer.disconnect();
      motion.removeEventListener("change", update);
      contrast.removeEventListener("change", update);
      document.removeEventListener("visibilitychange", update);
    };
  }, []);

  return (
    <div
      ref={host}
      className={styles.composerOrbs}
      data-focused={focused}
      data-running={eligible && !focused}
      aria-hidden="true"
    >
      {[0, 1, 2].map((orb) => (
        <span className={styles.composerOrbX} key={orb}>
          <span className={styles.composerOrbY}>
            <span className={styles.composerOrb} />
          </span>
        </span>
      ))}
    </div>
  );
});
