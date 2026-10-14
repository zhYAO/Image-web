import { afterEach, describe, expect, it, vi } from "vitest";
import { isApparelSourceReuseEnabled } from "@/server/apparel/apparel-config";
import { isApparelVisibleLoadingEnabled } from "@/features/commerce/apparel-display-config";

afterEach(() => vi.unstubAllEnvs());
describe("retired source reuse and independent visible loading", () => {
  it("locks both controls off in production even when both opt-ins are true", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ZIMAGE_APPAREL_SOURCE_REUSE_ENABLED", "true");
    vi.stubEnv("NEXT_PUBLIC_APPAREL_VISIBLE_LOADING_ENABLED", "true");
    expect(isApparelSourceReuseEnabled()).toBe(false);
    expect(isApparelVisibleLoadingEnabled()).toBe(false);
  });
  it.each(["development", "test"])(
    "ignores the retired source opt-in and preserves visible loading in %s",
    (mode) => {
      vi.stubEnv("NODE_ENV", mode);
      vi.stubEnv("ZIMAGE_APPAREL_SOURCE_REUSE_ENABLED", "true");
      vi.stubEnv("NEXT_PUBLIC_APPAREL_VISIBLE_LOADING_ENABLED", "true");
      expect(isApparelSourceReuseEnabled()).toBe(false);
      expect(isApparelVisibleLoadingEnabled()).toBe(true);
      vi.stubEnv("ZIMAGE_APPAREL_SOURCE_REUSE_ENABLED", "false");
      expect(isApparelSourceReuseEnabled()).toBe(false);
      expect(isApparelVisibleLoadingEnabled()).toBe(true);
    },
  );
  it.each([undefined, "false", "TRUE", "1", "invalid"])(
    "keeps both baseline paths for %s",
    (value) => {
      vi.stubEnv("ZIMAGE_APPAREL_SOURCE_REUSE_ENABLED", value);
      vi.stubEnv("NEXT_PUBLIC_APPAREL_VISIBLE_LOADING_ENABLED", value);
      expect(isApparelSourceReuseEnabled()).toBe(false);
      expect(isApparelVisibleLoadingEnabled()).toBe(false);
    },
  );
  it.each([true, false])(
    "keeps source reuse off independently of display: %s",
    (reuse) => {
      vi.stubEnv(
        "ZIMAGE_APPAREL_SOURCE_REUSE_ENABLED",
        reuse ? "true" : "false",
      );
      vi.stubEnv(
        "NEXT_PUBLIC_APPAREL_VISIBLE_LOADING_ENABLED",
        reuse ? "false" : "true",
      );
      expect(isApparelSourceReuseEnabled()).toBe(false);
      expect(isApparelVisibleLoadingEnabled()).toBe(!reuse);
    },
  );
});
