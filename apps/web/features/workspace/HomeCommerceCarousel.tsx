"use client";

import { COMMERCE_SCENES, COMMERCE_PRIMARY_SCENE_IDS } from "@zimage/domain";
import { ArrowLeft, ArrowRight, ArrowUpRight, Pause, Play } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
} from "react";
import { useMediaQuery } from "@/app/use-media-query";
import { commerceExampleForScene } from "@/features/commerce/commerce-examples";
import { commerceHref } from "./workspace-route";
import styles from "./home-commerce-carousel.module.css";

const featured = COMMERCE_PRIMARY_SCENE_IDS.map((id) =>
  COMMERCE_SCENES.find((scene) => scene.id === id)!,
);
type Gesture = {
  id: number;
  x: number;
  y: number;
  dx: number;
  locked: boolean;
};

export function HomeCommerceCarousel() {
  const compact = useMediaQuery("(max-width: 767px)");
  const reduced = useMediaQuery("(prefers-reduced-motion: reduce)");
  const size = compact ? 1 : 3;
  const last = Math.max(0, featured.length - size);
  const [cursor, setCursor] = useState(0);
  const index = Math.min(cursor, last);
  const [drag, setDrag] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [focusedPosition, setFocusedPosition] = useState<number | null>(null);
  const [focusRequest, setFocusRequest] = useState<number | null>(null);
  const [touching, setTouching] = useState(false);
  const [hidden, setHidden] = useState(false);
  const root = useRef<HTMLElement>(null);
  const gesture = useRef<Gesture | undefined>(undefined);
  const suppressClick = useRef(false);
  const wheel = useRef({ distance: 0, at: 0, changed: 0 });
  const [preferences, setPreferences] = useState({ last, reduced });
  if (preferences.last !== last || preferences.reduced !== reduced) {
    setPreferences({ last, reduced });
    setCursor((current) => Math.min(current, last));
    setDrag(0);
    if (
      focusedPosition !== null &&
      (focusedPosition < index || focusedPosition >= index + size)
    )
      setFocusRequest(index);
    if (reduced || index === last) setPlaying(false);
  }
  useLayoutEffect(() => {
    // Wait for aria-hidden/inert to reflect the new window before focusing.
    if (focusRequest !== null)
      root.current
        ?.querySelectorAll<HTMLAnchorElement>("a")
        [focusRequest]?.focus({ preventScroll: true });
  }, [focusRequest, index, size]);
  useEffect(() => {
    const visibility = () => setHidden(document.hidden);
    visibility();
    document.addEventListener("visibilitychange", visibility);
    return () => document.removeEventListener("visibilitychange", visibility);
  }, []);
  useEffect(() => {
    if (
      !playing ||
      reduced ||
      hovered ||
      focused ||
      touching ||
      hidden ||
      index >= last
    )
      return;
    const timer = window.setTimeout(() => {
      setCursor(index + 1);
      if (index + 1 >= last) setPlaying(false);
    }, 6000);
    return () => window.clearTimeout(timer);
  }, [playing, reduced, hovered, focused, touching, hidden, index, last]);

  const moveTo = (target: number) => {
    const next = Math.max(0, Math.min(last, target));
    setCursor(next);
    setPlaying(false);
    setDrag(0);
    // A keyboard move must not strand focus on a card that becomes inert.
    if (
      focusedPosition !== null &&
      (focusedPosition < next || focusedPosition >= next + size)
    )
      setFocusRequest(next);
  };
  const finish = (event: PointerEvent<HTMLDivElement>, cancel = false) => {
    const start = gesture.current;
    if (
      !start ||
      (event.pointerId !== undefined && start.id !== event.pointerId)
    )
      return;
    gesture.current = undefined;
    suppressClick.current = start.locked;
    setTouching(false);
    setDrag(0);
    if (event.currentTarget.hasPointerCapture?.(start.id))
      event.currentTarget.releasePointerCapture(start.id);
    if (!cancel && start.locked && Math.abs(start.dx) > 45)
      moveTo(index + (start.dx < 0 ? 1 : -1));
  };

  return (
    <section
      ref={root}
      className={styles.carousel}
      aria-label="电商生图"
      aria-roledescription="轮播"
      role="region"
      tabIndex={0}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocusCapture={(event) => {
        const link = (event.target as HTMLElement).closest("a");
        setFocusedPosition(
          link ? Number(link.getAttribute("data-position")) : null,
        );
        setFocusRequest(null);
        setFocused(event.target === event.currentTarget || Boolean(link));
      }}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setFocused(false);
          setFocusedPosition(null);
        }
      }}
      onKeyDown={(event) => {
        const target =
          event.key === "ArrowLeft"
            ? index - 1
            : event.key === "ArrowRight"
              ? index + 1
              : event.key === "Home"
                ? 0
                : event.key === "End"
                  ? last
                  : undefined;
        if (target !== undefined) {
          event.preventDefault();
          moveTo(target);
        }
      }}
    >
      <div className={styles.heading}>
        <h2>电商生图</h2>
        <div className={styles.controls}>
          <span
            className={styles.counter}
            aria-live={playing ? "off" : "polite"}
            aria-atomic="true"
          >
            {size === 1
              ? `${index + 1} / ${featured.length}`
              : `${index + 1}–${index + size} / ${featured.length}`}
          </span>
          <button
            type="button"
            aria-label={playing ? "暂停电商功能" : "播放电商功能"}
            aria-pressed={playing}
            disabled={reduced || (!playing && index === last)}
            title={reduced ? "已遵循减少动态效果设置" : undefined}
            onClick={() => setPlaying((current) => !current)}
          >
            {playing ? <Pause size={17} /> : <Play size={17} />}
          </button>
          <button
            type="button"
            aria-label="上一张电商功能"
            disabled={index === 0}
            onClick={() => moveTo(index - 1)}
          >
            <ArrowLeft size={17} />
          </button>
          <button
            type="button"
            aria-label="下一张电商功能"
            disabled={index === last}
            onClick={() => moveTo(index + 1)}
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
            moveTo(index + (wheel.current.distance > 0 ? 1 : -1));
            wheel.current = { distance: 0, at: now, changed: now };
          }
        }}
        onPointerDown={(event) => {
          if (event.button !== 0 || gesture.current) return;
          suppressClick.current = false;
          gesture.current = {
            id: event.pointerId,
            x: event.clientX,
            y: event.clientY,
            dx: 0,
            locked: false,
          };
          setTouching(true);
        }}
        onPointerMove={(event) => {
          const start = gesture.current;
          if (
            !start ||
            (event.pointerId !== undefined && start.id !== event.pointerId)
          )
            return;
          if (event.pointerType === "mouse" && event.buttons === 0) {
            finish(event, true);
            return;
          }
          const dx = event.clientX - start.x,
            dy = event.clientY - start.y;
          if (!start.locked) {
            if (Math.abs(dy) > 8 && Math.abs(dy) >= Math.abs(dx)) {
              gesture.current = undefined;
              setTouching(false);
              return;
            }
            if (Math.abs(dx) < 8 || Math.abs(dx) <= Math.abs(dy)) return;
            start.locked = true;
            if (event.pointerId !== undefined)
              event.currentTarget.setPointerCapture?.(event.pointerId);
            setPlaying(false);
          }
          event.preventDefault();
          start.dx = dx;
          const edge = (index === 0 && dx > 0) || (index === last && dx < 0);
          setDrag(edge ? dx * 0.18 : dx);
        }}
        onPointerUp={(event) => finish(event)}
        onPointerCancel={(event) => finish(event, true)}
        onPointerLeave={(event) => {
          if (!gesture.current?.locked) finish(event, true);
        }}
        onLostPointerCapture={(event) => finish(event, true)}
        onClickCapture={(event) => {
          if (suppressClick.current && event.detail > 0) {
            event.preventDefault();
            event.stopPropagation();
            suppressClick.current = false;
          }
        }}
      >
        <div
          className={styles.cards}
          data-dragging={drag !== 0}
          style={
            {
              "--carousel-index": index,
              "--carousel-drag": `${drag}px`,
            } as CSSProperties
          }
        >
          {featured.map((scene, position) => {
            const visible = position >= index && position < index + size;
            return (
              <Link
                draggable={false}
                className={styles.card}
                key={scene.id}
                href={commerceHref(scene.id)}
                aria-label={scene.name}
                data-position={position}
                aria-hidden={!visible}
                inert={!visible}
                tabIndex={visible ? 0 : -1}
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
            );
          })}
        </div>
      </div>
    </section>
  );
}
