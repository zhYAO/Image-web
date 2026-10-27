"use client";

import { publicAssetUrl } from "@/lib/public-assets";

import Image from "next/image";

import { useEffect, useRef, useState } from "react";
import { Image as ImageIcon, Sparkles } from "lucide-react";
import { Glass } from "@/features/brand/Glass";
import { canCycleGallery, GALLERY_INTERVAL_MS } from "./motion";

const gallery = [
  {
    label: "自然光影",
    image: "/commerce/meitu-v1/shoot-botanical.webp",
    alt: "自然光线中的香氛瓶创作示例",
    title: "把日常，拍出新的想象。",
    detail: "AI 商品图 · 自然光影",
    prompt: "一束自然光，一点新的想象",
  },
  {
    label: "生活场景",
    image: "/commerce/meitu-v1/kit-scene.webp",
    alt: "暖色居家场景中的耳机创作示例",
    title: "让商品，走进生活。",
    detail: "商品套图 · 生活场景",
    prompt: "让温暖的色彩，进入日常",
  },
  {
    label: "服装视觉",
    image: "/commerce/apparel-v2/main-1.webp",
    alt: "服装商品视觉创作示例",
    title: "好设计，值得被看见。",
    detail: "服装商品图片 · 品牌视觉",
    prompt: "从版型到质感，让细节说话",
  },
];

export function HeroGallery() {
  const host = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const [visited, setVisited] = useState<number[]>([0]);
  const [visible, setVisible] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [manual, setManual] = useState(false);
  const [paused, setPaused] = useState(false);
  // Safe SSR defaults never start motion before preferences and visibility are known.
  const [reducedMotion, setReducedMotion] = useState(true);
  const [hidden, setHidden] = useState(true);

  useEffect(() => {
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const preference = () => setReducedMotion(motion.matches);
    const visibility = () => setHidden(document.hidden);
    preference();
    visibility();
    motion.addEventListener("change", preference);
    document.addEventListener("visibilitychange", visibility);
    let observer: IntersectionObserver | undefined;
    if (host.current && "IntersectionObserver" in window) {
      observer = new IntersectionObserver(
        ([entry]) =>
          setVisible(
            Boolean(entry?.isIntersecting) &&
              (entry?.intersectionRatio ?? 0) >= 0.3,
          ),
        { threshold: 0.3 },
      );
      observer.observe(host.current);
    }
    return () => {
      observer?.disconnect();
      motion.removeEventListener("change", preference);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, []);

  useEffect(() => {
    if (
      !canCycleGallery({
        visible,
        hovered,
        focused,
        manual,
        paused,
        hidden,
        reducedMotion,
      })
    )
      return;
    const timer = window.setInterval(
      () => setIndex((current) => (current + 1) % gallery.length),
      GALLERY_INTERVAL_MS,
    );
    return () => window.clearInterval(timer);
  }, [visible, hovered, focused, manual, paused, hidden, reducedMotion]);

  return (
    <div
      ref={host}
      className="zl-showcase"
      aria-label="创作效果示例"
      onPointerEnter={(event) => {
        if (event.pointerType !== "touch") setHovered(true);
      }}
      onPointerLeave={() => {
        setHovered(false);
        setManual(false);
      }}
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setFocused(false);
          setManual(false);
        }
      }}
    >
      <div className="zl-float-card zl-float-left" aria-hidden="true">
        <Image
          src={publicAssetUrl("/commerce/meitu-v1/kit-scene.webp")}
          alt=""
          sizes="280px"
          width="280"
          height="350"
          loading="lazy"
          fetchPriority="low"
          decoding="async"
        />
        <span>日常，也可以不寻常</span>
      </div>
      <div className="zl-float-card zl-float-right" aria-hidden="true">
        <Image
          src={publicAssetUrl("/commerce/apparel-v2/main-1.webp")}
          alt=""
          sizes="280px"
          width="280"
          height="350"
          loading="lazy"
          fetchPriority="low"
          decoding="async"
        />
        <span>灵感，穿在身上</span>
      </div>
      <Glass className="zl-gallery-window">
        <div className="zl-window-header">
          <span className="zl-window-dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <span>ZImage / CREATIVE STUDIO</span>
          <span className="zl-window-example">静态示例</span>
        </div>
        <div className="zl-gallery-stage">
          {gallery.map((item, position) => (
            <figure
              key={item.image}
              className={`zl-gallery-frame${position === index ? " is-active" : ""}`}
              aria-hidden={position !== index}
            >
              {(position === index || visited.includes(position)) && (
                <Image
                  src={publicAssetUrl(item.image)}
                  alt={item.alt}
                  sizes="(max-width: 760px) 90vw, 630px"
                  width="1254"
                  height="1254"
                  decoding="async"
                  loading={position === 0 ? "eager" : "lazy"}
                  fetchPriority={position === 0 ? "high" : "auto"}
                  onLoad={() =>
                    setVisited((current) =>
                      current.includes(position)
                        ? current
                        : [...current, position],
                    )
                  }
                />
              )}
              <figcaption>
                <span>{item.detail}</span>
                <strong>{item.title}</strong>
              </figcaption>
            </figure>
          ))}
          <div className="zl-gallery-corner">
            <Sparkles aria-hidden="true" /> MADE OF IDEAS
          </div>
        </div>
        <div className="zl-gallery-toolbar">
          <span className="zl-gallery-prompt">
            <Sparkles aria-hidden="true" /> {gallery[index]?.prompt}
          </span>
          <div
            className="zl-gallery-tabs"
            role="group"
            aria-label="切换创作示例"
          >
            {gallery.map((item, position) => (
              <button
                key={item.label}
                type="button"
                aria-pressed={index === position}
                onClick={() => {
                  setIndex(position);
                  setManual(true);
                }}
              >
                {item.label}
              </button>
            ))}
            <button
              type="button"
              className="zl-gallery-pause"
              hidden={reducedMotion}
              aria-pressed={paused}
              aria-label={paused ? "恢复自动切换" : "暂停自动切换"}
              onClick={() => {
                setPaused((value) => !value);
                setManual(false);
              }}
            >
              {paused ? "▶" : "Ⅱ"}
            </button>
          </div>
        </div>
      </Glass>
      <Glass className="zl-floating-chip">
        <ImageIcon aria-hidden="true" /> 从灵感，到画面{" "}
        <span aria-hidden="true">↗</span>
      </Glass>
    </div>
  );
}
