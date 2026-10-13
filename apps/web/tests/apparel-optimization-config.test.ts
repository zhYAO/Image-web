import { afterEach, describe, expect, it, vi } from "vitest";
import { isApparelSourceReuseEnabled } from "@/server/apparel/apparel-config";
import { isApparelVisibleLoadingEnabled } from "@/features/commerce/apparel-display-config";

afterEach(() => vi.unstubAllEnvs());
describe("independent opt-in apparel controls", () => {
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
    "can enable reuse independently of display: %s",
    (reuse) => {
      vi.stubEnv(
        "ZIMAGE_APPAREL_SOURCE_REUSE_ENABLED",
        reuse ? "true" : "false",
      );
      vi.stubEnv(
        "NEXT_PUBLIC_APPAREL_VISIBLE_LOADING_ENABLED",
        reuse ? "false" : "true",
      );
      expect(isApparelSourceReuseEnabled()).toBe(reuse);
      expect(isApparelVisibleLoadingEnabled()).toBe(!reuse);
    },
  );
});
