import { describe, expect, it } from "vitest";
import type { ThemeConfig } from "antd";
import * as theme from "@/app/theme";

const themes = theme as typeof theme & {
  getZimageThemes?: (appearance: "light" | "dark") => {
    lobe: ThemeConfig;
    antd: ThemeConfig;
  };
};
describe("coordinated system themes", () => {
  it("keeps solid reading surfaces and the purple brand in light mode", () => {
    const config = themes.getZimageThemes?.("light");
    expect(config?.antd.token?.colorBgContainer).toBe("#ffffff");
    expect(config?.antd.token?.colorPrimary).toBe("#7050b5");
    expect(config?.lobe.token?.colorText).toBe(config?.antd.token?.colorText);
  });
  it("coordinates dark text, solid controls and purple aliases in both providers", () => {
    const config = themes.getZimageThemes?.("dark");
    expect(config?.antd.token?.colorBgContainer).toBe("#211e29");
    expect(config?.antd.token?.colorText).toBe("#f3eff8");
    expect(config?.antd.token?.colorPrimary).toBe("#b79be5");
    expect(config?.lobe.token).toEqual(config?.antd.token);
    expect(config?.antd.algorithm).not.toBe(theme.zimageAntdTheme.algorithm);
  });
});
