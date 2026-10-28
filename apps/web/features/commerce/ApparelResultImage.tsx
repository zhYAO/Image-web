"use client";
import { PreviewImage } from '@/features/controls/PreviewImage';
import { useEffect, useRef, useState } from "react";

import styles from "./apparel.module.css";
import { isApparelVisibleLoadingEnabled } from "./apparel-display-config";

export function ApparelResultImage({
  url,
  name,
}: {
  url: string;
  name: string;
}) {
  return isApparelVisibleLoadingEnabled() ? (
    <VisibleApparelImage key={url} url={url} name={name} />
  ) : (
    <PreviewImage src={url} alt={name} />
  );
}

function VisibleApparelImage({ url, name }: { url: string; name: string }) {
  const element = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const target = element.current;
    if (!target) return;
    if (typeof IntersectionObserver === "undefined") {
      const timer = window.setTimeout(() => setVisible(true), 0);
      return () => window.clearTimeout(timer);
    }
    let active = true;
    // The viewport root also applies clipping by the scrollable aside ancestors.
    // It covers the mobile document scroll when that aside no longer scrolls.
    const observer = new IntersectionObserver(
      (entries) => {
        if (active && entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { root: null, rootMargin: "160px", threshold: 0 },
    );
    observer.observe(target);
    return () => {
      active = false;
      observer.disconnect();
    };
  }, []);
  return (
    <div ref={element} className={styles.resultImage}>
      {visible ? (
        <PreviewImage src={url} alt={name} />
      ) : (
        <button
          type="button"
          onClick={() => setVisible(true)}
          aria-label={`加载 ${name}`}
        >
          查看图片
        </button>
      )}
    </div>
  );
}
