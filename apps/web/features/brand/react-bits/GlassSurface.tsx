"use client";

import {
  useCallback,
  useEffect,
  useRef,
  type ComponentPropsWithoutRef,
  type ElementType,
  type Ref,
  type ReactNode,
} from "react";

type GlassSurfaceProps<E extends ElementType> = {
  as?: E;
  refract?: boolean;
  ref?: Ref<HTMLElement>;
  className?: string;
  children?: ReactNode;
} & Omit<ComponentPropsWithoutRef<E>, "as" | "ref" | "className" | "children">;

/**
 * React Bits GlassSurface adaptation with a semantic, stable host.
 * SVG channel/map pipeline and paint derive from the pinned official source.
 * Geometry and direct children remain owned by callers; no extra flex wrapper.
 * CSS fallback is the default; the optional SVG controller loads only on demand.
 */
export default function GlassSurface<E extends ElementType = "div">({
  as,
  refract = false,
  className = "",
  children,
  ref,
  style,
  ...rest
}: GlassSurfaceProps<E>) {
  const element = useRef<HTMLElement | null>(null);
  const setElement = useCallback(
    (node: HTMLElement | null) => {
      element.current = node;
      if (typeof ref === "function") {
        const cleanup = ref(node);
        if (typeof cleanup === "function")
          return () => {
            element.current = null;
            cleanup();
          };
      } else if (ref) ref.current = node;
    },
    [ref],
  );
  useEffect(() => {
    if (!refract || !element.current) return;
    const target = element.current;
    let disposed = false;
    let cleanup: (() => void) | undefined;
    void import("./GlassSurfaceEffect.js")
      .then(({ enhanceLiquidGlass }) => {
        if (!disposed) cleanup = enhanceLiquidGlass(target);
      })
      .catch(() => {
        // CSS-only translucent material remains usable when the enhancement fails.
      });
    return () => {
      disposed = true;
      cleanup?.();
    };
  }, [
    refract,
    as,
    className,
    style?.borderRadius,
    style?.borderTopLeftRadius,
    style?.borderTopRightRadius,
    style?.borderBottomRightRadius,
    style?.borderBottomLeftRadius,
  ]);
  const Tag: ElementType = as || "div";
  return (
    <Tag
      {...rest}
      ref={setElement}
      style={style}
      className={`liquid-glass glass-surface glass-surface--fallback ${className}`.trim()}
      data-liquid-glass={refract ? "refract" : undefined}
    >
      {children}
    </Tag>
  );
}
