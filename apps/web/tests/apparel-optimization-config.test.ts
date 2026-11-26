import { afterEach, describe, expect, it, vi } from "vitest";
import { isApparelVisibleLoadingEnabled } from "@/features/commerce/apparel-display-config";

afterEach(() => vi.unstubAllEnvs());

describe("apparel visible loading", () => {
  it("stays off in production even with an explicit opt-in", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_APPAREL_VISIBLE_LOADING_ENABLED", "true");
    expect(isApparelVisibleLoadingEnabled()).toBe(false);
  });

  it.each(["development", "test"])("allows an explicit opt-in in %s", (mode) => {
    vi.stubEnv("NODE_ENV", mode);
    vi.stubEnv("NEXT_PUBLIC_APPAREL_VISIBLE_LOADING_ENABLED", "true");
    expect(isApparelVisibleLoadingEnabled()).toBe(true);
  });

  it.each([undefined, "false", "TRUE", "1", "invalid"])(
    "stays off for %s",
    (value) => {
      vi.stubEnv("NEXT_PUBLIC_APPAREL_VISIBLE_LOADING_ENABLED", value);
      expect(isApparelVisibleLoadingEnabled()).toBe(false);
    },
  );
});
