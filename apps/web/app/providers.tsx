"use client";

import { ThemeProvider } from "@lobehub/ui";
import { ConfigProvider } from "antd";
import type { PropsWithChildren } from "react";
import { useLayoutEffect } from "react";
import { StyleRegistry } from "./style-registry";
import { getZimageThemes } from "./theme";
import { useMediaQuery } from "./use-media-query";

export function AppProviders({ children }: PropsWithChildren) {
  const dark = useMediaQuery("(prefers-color-scheme: dark)");
  const appearance = dark ? "dark" : "light";
  const themes = getZimageThemes(appearance);
  useLayoutEffect(() => {
    // Also restore the pre-paint attribute after the development StrictMode remount.
    document.documentElement.dataset.zTheme = window.matchMedia(
      "(prefers-color-scheme: dark)",
    ).matches
      ? "dark"
      : "light";
  }, [appearance]);
  return (
    <StyleRegistry>
      <ThemeProvider
        appearance={appearance}
        customTheme={{ neutralColor: "slate", primaryColor: "purple" }}
        defaultAppearance="light"
        defaultThemeMode="light"
        enableCustomFonts={false}
        enableGlobalStyle={false}
        theme={themes.lobe}
      >
        <ConfigProvider theme={themes.antd}>{children}</ConfigProvider>
      </ThemeProvider>
    </StyleRegistry>
  );
}
