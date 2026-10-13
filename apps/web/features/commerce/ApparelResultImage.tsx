"use client";
import { useEffect, useRef, useState } from "react";
import { Image } from "antd";
import styles from "./apparel.module.css";

export function ApparelResultImage({
  url,
  name,
}: {
  url: string;
  name: string;
}) {
  const element = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const target = element.current;
    if (!target || typeof IntersectionObserver === "undefined") return;
    // The viewport root also applies clipping by the scrollable aside ancestors.
    // It covers the mobile document scroll when that aside no longer scrolls.
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { root: null, rootMargin: "160px" },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={element} className={styles.resultImage}>
      {visible ? (
        <Image src={url} alt={name} />
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
