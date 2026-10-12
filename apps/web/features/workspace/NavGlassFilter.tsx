"use client";

import { useEffect, useId, useRef } from "react";
import { useMediaQuery } from "@/app/use-media-query";

// Adapted from clone-web/open-design-home-clone/zh/index.html enhanceHeader,
// which credits Inspira UI LiquidGlass.vue. This is not Apple-provided code.
// The displacement is reduced to 6–8px and used only behind the navigation.
function glassMap(width: number, height: number) {
  const w = Math.max(1, Math.round(width)),
    h = Math.max(1, Math.round(height));
  const r = Math.min(24, Math.round(h / 2)),
    inset = Math.min(w, h) * 0.035;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}"><defs><linearGradient id="r" x1="100%" x2="0%"><stop stop-color="#000"/><stop offset="1" stop-color="red"/></linearGradient><linearGradient id="b" x1="0%" y1="0%" x2="0%" y2="100%"><stop stop-color="#000"/><stop offset="1" stop-color="blue"/></linearGradient></defs><rect width="${w}" height="${h}" fill="black"/><rect width="${w}" height="${h}" rx="${r}" fill="url(#r)"/><rect width="${w}" height="${h}" rx="${r}" fill="url(#b)" style="mix-blend-mode:difference"/><rect x="${inset}" y="${inset}" width="${w - inset * 2}" height="${h - inset * 2}" rx="${r}" fill="hsl(0 0% 50% / .93)" style="filter:blur(11px)"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

export function NavGlassFilter() {
  const id = `z-nav-glass-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const svg = useRef<SVGSVGElement>(null);
  const image = useRef<SVGFEImageElement>(null);
  const reduced = useMediaQuery("(prefers-reduced-transparency: reduce)");
  const contrast = useMediaQuery("(prefers-contrast: more)");
  const forced = useMediaQuery("(forced-colors: active)");
  useEffect(() => {
    const header = svg.current?.parentElement;
    if (
      !header ||
      reduced ||
      contrast ||
      forced ||
      typeof CSS === "undefined" ||
      typeof CSS.supports !== "function" ||
      !CSS.supports("backdrop-filter", `url("#${id}") blur(1px)`)
    )
      return;
    let timer = 0,
      previous = "";
    const sync = () => {
      const rect = header.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const dimensions = `${Math.round(rect.width)}x${Math.round(rect.height)}`;
      if (dimensions === previous) return;
      previous = dimensions;
      image.current?.setAttribute("href", glassMap(rect.width, rect.height));
      header.style.setProperty(
        "--z-nav-backdrop",
        `url("#${id}") blur(10px) saturate(1.2)`,
      );
    };
    const schedule = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(sync, 140);
    };
    sync();
    const observer =
      typeof ResizeObserver === "undefined"
        ? undefined
        : new ResizeObserver(schedule);
    observer?.observe(header);
    window.addEventListener("resize", schedule, { passive: true });
    return () => {
      window.clearTimeout(timer);
      observer?.disconnect();
      window.removeEventListener("resize", schedule);
      header.style.removeProperty("--z-nav-backdrop");
    };
  }, [id, reduced, contrast, forced]);
  return (
    <svg
      ref={svg}
      width="0"
      height="0"
      aria-hidden="true"
      focusable="false"
      style={{
        position: "absolute",
        pointerEvents: "none",
        overflow: "hidden",
      }}
    >
      <defs>
        <filter id={id} colorInterpolationFilters="sRGB">
          <feImage
            ref={image}
            width="100%"
            height="100%"
            preserveAspectRatio="none"
            result="map"
          />
          <feDisplacementMap
            in="SourceGraphic"
            in2="map"
            xChannelSelector="R"
            yChannelSelector="B"
            scale="-8"
            result="dr"
          />
          <feColorMatrix
            in="dr"
            type="matrix"
            values="1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0"
            result="red"
          />
          <feDisplacementMap
            in="SourceGraphic"
            in2="map"
            xChannelSelector="R"
            yChannelSelector="B"
            scale="-7"
            result="dg"
          />
          <feColorMatrix
            in="dg"
            type="matrix"
            values="0 0 0 0 0 0 1 0 0 0 0 0 0 0 0 0 0 0 1 0"
            result="green"
          />
          <feDisplacementMap
            in="SourceGraphic"
            in2="map"
            xChannelSelector="R"
            yChannelSelector="B"
            scale="-6"
            result="db"
          />
          <feColorMatrix
            in="db"
            type="matrix"
            values="0 0 0 0 0 0 0 0 0 0 0 0 1 0 0 0 0 0 1 0"
            result="blue"
          />
          <feBlend in="red" in2="green" mode="screen" result="rg" />
          <feBlend in="rg" in2="blue" mode="screen" result="rgb" />
          <feGaussianBlur in="rgb" stdDeviation="0.3" />
        </filter>
      </defs>
    </svg>
  );
}
