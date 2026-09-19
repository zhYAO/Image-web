"use client";

import { ThemeProvider } from "@lobehub/ui";
import { ConfigProvider } from "antd";
import type { PropsWithChildren } from "react";
import { StyleRegistry } from "./style-registry";
import { zimageAntdTheme, zimageTheme } from "./theme";

export function AppProviders({ children }: PropsWithChildren) {
  return (
    <StyleRegistry>
      <ThemeProvider
        appearance="light"
        customTheme={{ neutralColor: "slate", primaryColor: "purple" }}
        defaultAppearance="light"
        defaultThemeMode="light"
        enableCustomFonts={false}
        theme={zimageTheme}
      >
        <ConfigProvider theme={zimageAntdTheme}>{children}</ConfigProvider>
      </ThemeProvider>
    </StyleRegistry>
  );
}
