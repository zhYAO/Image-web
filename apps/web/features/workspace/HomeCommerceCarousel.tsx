"use client";

import { COMMERCE_SCENES, COMMERCE_PRIMARY_SCENE_IDS } from "@zimage/domain";
import { ArrowLeft, ArrowRight, ArrowUpRight } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { commerceExampleForScene } from "@/features/commerce/commerce-examples";
import { commerceHref } from "./workspace-route";
import styles from "./home-commerce-carousel.module.css";

export function HomeCommerceCarousel() {
  const featured = COMMERCE_PRIMARY_SCENE_IDS.map(id => COMMERCE_SCENES.find(scene => scene.id === id)!);
  const [page, setPage] = useState(0);
  const [compact, setCompact] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [touching, setTouching] = useState(false);
  const root = useRef<HTMLElement>(null);
  const wheel = useRef({ distance: 0, at: 0, changed: 0 });
  const gesture = useRef<{ x: number; y: number } | undefined>(undefined);
  const suppressClick = useRef(false);
  const size = compact ? 1 : 3;
  const pages = Math.ceil(featured.length / size);
  const move = (direction: number) =>
    setPage((current) => (current + direction + pages) % pages);

  useEffect(() => {
    const mobile = window.matchMedia("(max-width: 767px)");
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => {
      setCompact(mobile.matches);
      setReducedMotion(reduced.matches);
      setPage(0);
    };
    const visibility = () => setHidden(document.hidden);
    sync();
    visibility();
    mobile.addEventListener("change", sync);
    reduced.addEventListener("change", sync);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      mobile.removeEventListener("change", sync);
      reduced.removeEventListener("change", sync);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, []);

  useEffect(() => {
    if (hovered || focused || touching || hidden || reducedMotion) return;
    const timer = window.setTimeout(
      () => setPage((current) => (current + 1) % pages),
      5000,
    );
    return () => window.clearTimeout(timer);
  }, [page, pages, hovered, focused, touching, hidden, reducedMotion]);

  useEffect(() => {
    setFocused(
      (current) =>
        current && Boolean(root.current?.contains(document.activeElement)),
    );
  }, [page, compact]);

  const scenes = Array.from(
    { length: size },
    (_, index) =>
      featured[(page * size + index) % featured.length]!,
  );
  return (
    <section
      ref={root}
      className={styles.carousel}
      aria-label="电商生图"
      aria-roledescription="轮播"
      role="region"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget))
          setFocused(false);
      }}
    >
      <div className={styles.heading}>
        <h2>电商生图</h2>
        <div className={styles.controls}>
          <span className={styles.counter} aria-live="off">
            {page + 1} / {pages}
          </span>
          <button
            type="button"
            aria-label="上一组电商功能"
            onClick={() => move(-1)}
          >
            <ArrowLeft size={17} />
          </button>
          <button
            type="button"
            aria-label="下一组电商功能"
            onClick={() => move(1)}
          >
            <ArrowRight size={17} />
          </button>
        </div>
      </div>
      <div
        className={styles.viewport}
        onWheel={(event) => {
          if (Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return;
          const now = Date.now();
          if (now - wheel.current.changed < 400) return;
          if (now - wheel.current.at > 180) wheel.current.distance = 0;
          wheel.current.at = now;
          wheel.current.distance += event.deltaX;
          if (Math.abs(wheel.current.distance) > 60) {
            move(wheel.current.distance > 0 ? 1 : -1);
            wheel.current = { distance: 0, at: now, changed: now };
          }
        }}
        onPointerDown={(event) => {
          suppressClick.current = false;
          gesture.current = { x: event.clientX, y: event.clientY };
          setTouching(true);
        }}
        onPointerCancel={() => {
          gesture.current = undefined;
          setTouching(false);
        }}
        onPointerLeave={() => {
          gesture.current = undefined;
          setTouching(false);
        }}
        onPointerUp={(event) => {
          const start = gesture.current;
          gesture.current = undefined;
          setTouching(false);
          if (!start) return;
          const dx = event.clientX - start.x;
          if (
            Math.abs(dx) > 45 &&
            Math.abs(dx) > Math.abs(event.clientY - start.y)
          ) {
            suppressClick.current = true;
            move(dx < 0 ? 1 : -1);
          }
        }}
        onClickCapture={(event) => {
          if (suppressClick.current) {
            event.preventDefault();
            event.stopPropagation();
            suppressClick.current = false;
          }
        }}
      >
        <div className={styles.cards} key={`${size}-${page}`}>
          {scenes.map((scene) => (
            <Link
              draggable={false}
              className={styles.card}
              key={scene.id}
              href={commerceHref(scene.id)}
              aria-label={scene.name}
            >
              <div className={styles.cover}>
                <Image
                  draggable={false}
                  src={commerceExampleForScene(scene.id)}
                  alt={`${scene.name} · AI 风格示例`}
                  width={512}
                  height={512}
                  sizes="(max-width: 767px) 85vw, 260px"
                />
              </div>
              <div className={styles.caption}>
                <span>{scene.name}</span>
                <ArrowUpRight size={17} aria-hidden />
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
