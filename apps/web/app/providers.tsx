"use client";

import type { PropsWithChildren } from "react";
import { useLayoutEffect } from "react";
import { useMediaQuery } from "./use-media-query";

export function AppProviders({ children }: PropsWithChildren) {
  const dark = useMediaQuery("(prefers-color-scheme: dark)");
  useLayoutEffect(() => {
    // Also restore the pre-paint attribute after the development StrictMode remount.
    document.documentElement.dataset.zTheme = window.matchMedia(
      "(prefers-color-scheme: dark)",
    ).matches
      ? "dark"
      : "light";
  }, [dark]);
  return children;
}
