"use client";

import { publicAssetUrl } from "@/lib/public-assets";

import Image from "next/image";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  Archive,
  ArrowRight,
  Image as ImageIcon,
  MessagesSquare,
  Sparkles,
} from "lucide-react";
import { Glass } from "@/features/brand/Glass";
import { BrandMark } from "./BrandMark";
import { isReelPinned, reelFrameState } from "./motion";

const steps = [
  ["01", "先聊聊，想象中的样子", "用自然的对话，梳理主体、光线、色彩与构图。"],
  ["02", "选一个，适合你的场景", "从商品主图到成套视觉，让创作有清晰的方向。"],
  [
    "03",
    "留下来，让灵感继续",
    "在资产库回看会话中的生成图片，找到下一次创作的起点。",
  ],
];
const library: [string, string][] = [
  ["/commerce/meitu-v1/kit-scene.webp", "生活场景"],
  ["/commerce/meitu-v1/shoot-botanical.webp", "自然光影"],
  ["/commerce/apparel-v2/main-1.webp", "服装视觉"],
  ["/commerce/meitu-v1/clone-result.webp", "灵感再创作"],
];

export function WorkflowReel() {
  const section = useRef<HTMLElement>(null);
  const sticky = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const frames = useRef<Array<HTMLElement | null>>([]);

  useEffect(() => {
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0;
    let visible = true;
    const update = () => {
      frame = 0;
      if (document.hidden || !section.current || !sticky.current) return;
      if (
        !isReelPinned(window.innerWidth, window.innerHeight, motion.matches)
      ) {
        frames.current.forEach((element) => {
          element?.style.removeProperty("transform");
          element?.style.removeProperty("z-index");
        });
        return;
      }
      if (!visible) return;
      const next = reelFrameState(
        -section.current.getBoundingClientRect().top,
        section.current.offsetHeight - sticky.current.offsetHeight,
        steps.length,
      );
      // The continuous transform is an animation effect. React owns every frame,
      // the selected step and all interaction; no markup or DOM trees are replaced.
      frames.current.forEach((element, index) => {
        if (element) {
          element.style.transform = `translateY(${next.offsets[index]}%)`;
          element.style.zIndex = String(index + 1);
        }
      });
      setActive((current) => (current === next.active ? current : next.active));
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
    if (section.current && "IntersectionObserver" in window) {
      observer = new IntersectionObserver(
        ([entry]) => {
          visible = Boolean(entry?.isIntersecting);
          if (visible) schedule();
        },
        { rootMargin: "200px" },
      );
      observer.observe(section.current);
    }
    window.addEventListener("scroll", scroll, { passive: true });
    window.addEventListener("resize", schedule, { passive: true });
    document.addEventListener("visibilitychange", visibility);
    motion.addEventListener("change", schedule);
    update();
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener("scroll", scroll);
      window.removeEventListener("resize", schedule);
      document.removeEventListener("visibilitychange", visibility);
      motion.removeEventListener("change", schedule);
    };
  }, []);

  const selectStep = (index: number) => {
    if (!section.current || !sticky.current) return;
    if (
      !isReelPinned(
        window.innerWidth,
        window.innerHeight,
        window.matchMedia("(prefers-reduced-motion: reduce)").matches,
      )
    ) {
      setActive(index);
      return;
    }
    const range = Math.max(
      1,
      section.current.offsetHeight - sticky.current.offsetHeight,
    );
    window.scrollTo({
      top:
        window.scrollY +
        section.current.getBoundingClientRect().top +
        (index / (steps.length - 1)) * range,
      behavior: "smooth",
    });
  };

  return (
    <section
      ref={section}
      className="zl-cap-scrolly"
      id="landing-workflow"
      aria-labelledby="landing-workflow-title"
    >
      <div ref={sticky} className="zl-cap-sticky zl-container">
        <div className="zl-cap-copy">
          <span className="zl-eyebrow">FROM IDEA TO IMAGE</span>
          <h2 id="landing-workflow-title">
            你的创作节奏，
            <br />
            我们跟得上。
          </h2>
          <p className="zl-section-description">
            从一个念头出发，逐步走向完整的视觉表达。
          </p>
          <div className="zl-cap-steps" role="group" aria-label="创作流程">
            {steps.map(([number, title, description], index) => (
              <button
                key={number}
                type="button"
                className={`zl-cap-step${active === index ? " is-active" : ""}`}
                aria-pressed={active === index}
                aria-controls={`workflow-frame-${index}`}
                onClick={() => selectStep(index)}
              >
                <span className="zl-step-number">{number}</span>
                <span>
                  <strong>{title}</strong>
                  <small>{description}</small>
                </span>
                <span className="zl-step-dot" aria-hidden="true" />
              </button>
            ))}
          </div>
          <Link href="/workspace" className="zl-text-link">
            进入创作工作台 <ArrowRight aria-hidden="true" />
          </Link>
        </div>
        <div className="zl-cap-reel" aria-label="创作流程示例">
          <article
            id="workflow-frame-0"
            className={`zl-cap-frame zl-frame-idea${active === 0 ? " is-active" : ""}`}
            aria-hidden={active !== 0}
            ref={(element) => {
              frames.current[0] = element;
            }}
          >
            <div className="zl-reel-top">
              <span>01 / START WITH AN IDEA</span>
              <MessagesSquare aria-hidden="true" />
            </div>
            <div className="zl-idea-art">
              <div className="zl-orb-art" />
              <div className="zl-idea-mark">
                <BrandMark />
              </div>
              <Glass className="zl-idea-tag tag-light">自然光</Glass>
              <Glass className="zl-idea-tag tag-color">温暖的色调</Glass>
              <Glass className="zl-idea-tag tag-texture">细腻的材质</Glass>
            </div>
            <div className="zl-demo-chat">
              <span>我想为一款香氛，拍一张有呼吸感的图。</span>
              <p>
                <Sparkles aria-hidden="true" /> 试试窗边的柔光、浅色石材，
                <br />
                再留一点绿意。
              </p>
            </div>
            <span className="zl-reel-caption">
              把模糊的灵感，变成清晰的方向。<small>对话示意</small>
            </span>
          </article>
          <article
            id="workflow-frame-1"
            className={`zl-cap-frame zl-frame-scene${active === 1 ? " is-active" : ""}`}
            aria-hidden={active !== 1}
            ref={(element) => {
              frames.current[1] = element;
            }}
          >
            <div className="zl-reel-top">
              <span>02 / FIND YOUR SCENE</span>
              <ImageIcon aria-hidden="true" />
            </div>
            <div className="zl-scene-stack">
              <Image
                src={publicAssetUrl("/commerce/meitu-v1/shoot-studio.webp")}
                alt="香氛影棚场景示例"
                loading="lazy"
                decoding="async"
                sizes="(max-width: 760px) 70vw, 380px"
                width="1254"
                height="1254"
              />
              <Image
                src={publicAssetUrl("/commerce/meitu-v1/shoot-botanical.webp")}
                alt="香氛自然场景示例"
                loading="lazy"
                decoding="async"
                sizes="(max-width: 760px) 70vw, 380px"
                width="1254"
                height="1254"
              />
            </div>
            <span className="zl-reel-caption">
              同一个商品，不止一种表达。<small>已有创作示例</small>
            </span>
          </article>
          <article
            id="workflow-frame-2"
            className={`zl-cap-frame zl-frame-library${active === 2 ? " is-active" : ""}`}
            aria-hidden={active !== 2}
            ref={(element) => {
              frames.current[2] = element;
            }}
          >
            <div className="zl-reel-top">
              <span>03 / KEEP THE INSPIRATION</span>
              <Archive aria-hidden="true" />
            </div>
            <div className="zl-mini-library">
              {library.map(([src, label]) => (
                <div key={src}>
                  <Image
                    src={publicAssetUrl(src)}
                    alt={`${label}示例`}
                    loading="lazy"
                    decoding="async"
                    sizes="(max-width: 760px) 35vw, 180px"
                    width="400"
                    height="400"
                  />
                  <span>{label}</span>
                </div>
              ))}
            </div>
            <span className="zl-reel-caption">
              每一次积累，都为下一次灵感。<small>资产库示意</small>
            </span>
          </article>
        </div>
      </div>
    </section>
  );
}
