"use client";

/**
 * App-specific adaptation of React Bits FadeContent, Copyright (c) 2026 David Haz.
 * MIT + Commons Clause; see licenses/react-bits-LICENSE.md.
 * Source revision: 496968c4117e21278f13917201b7d615bc5e7450.
 * Keeps the fade/optional-blur wrapper and API subset. Native IntersectionObserver
 * and Web Animations replace GSAP/ScrollTrigger for this single modest effect.
 * Server HTML stays visible; motion enhances content only after hydration.
 */
import {
  useEffect,
  useRef,
  type HTMLAttributes,
  type ReactNode,
  type RefObject,
} from "react";

export interface FadeContentOptions {
  blur?: boolean;
  /** Milliseconds, consistently. */
  duration?: number;
  /** Milliseconds, consistently. */
  delay?: number;
  /** CSS easing, rather than GSAP easing names. */
  ease?: string;
  threshold?: number;
  rootMargin?: string;
  initialOpacity?: number;
  /** Optional, small vertical reveal distance in pixels. */
  distance?: number;
  onComplete?: () => void;
}

export interface FadeContentProps
  extends HTMLAttributes<HTMLDivElement>, FadeContentOptions {
  children: ReactNode;
}

export interface FadeContentEffectProps extends FadeContentOptions {
  targetRef: RefObject<HTMLDivElement | null>;
}

function useFadeContentAnimation(
  ref: RefObject<HTMLDivElement | null>,
  {
    blur = false,
    duration = 600,
    delay = 0,
    ease = "cubic-bezier(0.22, 1, 0.36, 1)",
    threshold = 0.12,
    rootMargin = "0px",
    initialOpacity = 0,
    distance = 12,
    onComplete,
  }: FadeContentOptions,
) {
  const callback = useRef(onComplete);
  useEffect(() => {
    callback.current = onComplete;
  }, [onComplete]);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const preference = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    let animation: Animation | undefined;
    let observer: IntersectionObserver | undefined;
    let revealed = false;
    let alive = true;
    let completed = false;

    const complete = () => {
      if (!alive || completed) return;
      completed = true;
      callback.current?.();
    };
    const show = () => {
      if (revealed || !alive) return;
      revealed = true;
      observer?.disconnect();
      if (preference?.matches || !element.animate || duration <= 0) {
        complete();
        return;
      }
      animation = element.animate(
        [
          {
            opacity: Math.min(1, Math.max(0, initialOpacity)),
            filter: blur ? "blur(6px)" : "blur(0px)",
            transform: `translateY(${distance}px)`,
          },
          { opacity: 1, filter: "blur(0px)", transform: "translateY(0)" },
        ],
        {
          duration,
          delay: Math.max(0, delay),
          easing: ease,
          fill: "backwards",
        },
      );
      animation.onfinish = complete;
      if (document.hidden) animation.pause();
    };
    const showWithoutMotion = () => {
      revealed = true;
      observer?.disconnect();
      animation?.cancel();
      complete();
    };
    const onPreference = (event: MediaQueryListEvent) => {
      if (event.matches) showWithoutMotion();
    };
    const onVisibility = () => {
      if (!animation || completed) return;
      if (document.hidden) animation.pause();
      else animation.play();
    };

    if (preference?.matches || typeof IntersectionObserver === "undefined")
      show();
    else {
      observer = new IntersectionObserver(
        (entries) => {
          if (entries.some((entry) => entry.isIntersecting)) show();
        },
        { threshold: Math.min(1, Math.max(0, threshold)), rootMargin },
      );
      observer.observe(element);
    }
    // Keyboard navigation must never land on temporarily transparent content.
    element.addEventListener("focusin", showWithoutMotion);
    preference?.addEventListener("change", onPreference);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      alive = false;
      observer?.disconnect();
      animation?.cancel();
      element.removeEventListener("focusin", showWithoutMotion);
      preference?.removeEventListener("change", onPreference);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [
    ref,
    blur,
    delay,
    distance,
    duration,
    ease,
    initialOpacity,
    rootMargin,
    threshold,
  ]);
}

/**
 * Deferred effect controller for an existing stable host. It adds no DOM and
 * does not wrap, replace, or remount the server-rendered children when loaded.
 */
export function FadeContentEffect({
  targetRef,
  ...options
}: FadeContentEffectProps) {
  useFadeContentAnimation(targetRef, options);
  return null;
}

export default function FadeContent({
  children,
  blur,
  duration,
  delay,
  ease,
  threshold,
  rootMargin,
  initialOpacity,
  distance,
  onComplete,
  className = "",
  style,
  ...props
}: FadeContentProps) {
  const ref = useRef<HTMLDivElement>(null);
  useFadeContentAnimation(ref, {
    blur,
    duration,
    delay,
    ease,
    threshold,
    rootMargin,
    initialOpacity,
    distance,
    onComplete,
  });
  return (
    <div ref={ref} className={className} style={style} {...props}>
      {children}
    </div>
  );
}
