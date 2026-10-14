import { render, screen } from "@testing-library/react";
import { theme as antdTheme } from "antd";
import { useTheme } from "antd-style";
import { afterEach, expect, it, vi } from "vitest";
import { AppProviders } from "@/app/providers";

function PaletteProbe() {
  const lobe = useTheme();
  const { token } = antdTheme.useToken();
  return (
    <>
      <output data-testid="lobe-primary">{lobe.colorPrimary}</output>
      <output data-testid="antd-primary">{token.colorPrimary}</output>
    </>
  );
}
afterEach(() => vi.restoreAllMocks());
it.each(["light", "dark"])(
  "coordinates the real Lobe and AntD derived primary in %s",
  (mode) => {
    const original = window.matchMedia;
    vi.spyOn(window, "matchMedia").mockImplementation((query) => ({
      ...original(query),
      matches: mode === "dark" && query === "(prefers-color-scheme: dark)",
    }));
    render(
      <AppProviders>
        <PaletteProbe />
      </AppProviders>,
    );
    expect(screen.getByTestId("lobe-primary").textContent).toBe(
      screen.getByTestId("antd-primary").textContent,
    );
  },
);
