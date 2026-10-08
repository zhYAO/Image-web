import { providerConfiguration } from "../_shared/generation-runner";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildSeedreamRequest,
  type ProviderImageInput,
} from "../_shared/image-providers";

const input: ProviderImageInput = {
  model: "doubao-seedream-5-0-flash-260915",
  prompt: "商品图片",
  aspectRatio: "3:4",
  resolution: "2K",
  references: [],
};
describe("Seedream 5.0 request contract", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("maps Flash, Pro and draining historical jobs to independent deployments", () => {
    const config: Record<string, string> = {
      ARK_API_KEY: "test-key",
      ZIMAGE_SEEDREAM_FLASH_IMAGE_MODEL: "doubao-seedream-5-0-flash-260915",
      ZIMAGE_SEEDREAM_PRO_IMAGE_MODEL: "doubao-seedream-5-0-pro-260628",
      ZIMAGE_SEEDREAM_IMAGE_MODEL: "legacy-deployment",
    };
    vi.stubGlobal("Deno", { env: { get: (key: string) => config[key] } });
    expect(providerConfiguration("seedream", "seedream-5.0-flash").model).toBe(
      config.ZIMAGE_SEEDREAM_FLASH_IMAGE_MODEL,
    );
    expect(providerConfiguration("seedream", "seedream-5.0-pro").model).toBe(
      config.ZIMAGE_SEEDREAM_PRO_IMAGE_MODEL,
    );
    expect(providerConfiguration("seedream", "seedream-4.5").model).toBe(
      "legacy-deployment",
    );
    expect(() => providerConfiguration("seedream", "unknown")).toThrow();
  });
  it("keeps legacy requests readable with the old reference and batch switches", () => {
    const request = buildSeedreamRequest({
      ...input,
      legacySeedream: true,
      references: Array(14).fill({
        mimeType: "image/jpeg",
        bytesBase64: "/9j/",
      }),
    });
    expect(request.image).toHaveLength(14);
    expect(request).toMatchObject({
      sequential_image_generation: "disabled",
      stream: false,
    });
  });
  it("sends a single-image request without unsupported batch or stream switches", () => {
    const request = buildSeedreamRequest(input);
    expect(request.model).toBe("doubao-seedream-5-0-flash-260915");
    expect(request).not.toHaveProperty("sequential_image_generation");
    expect(request).not.toHaveProperty("stream");
    expect(request.size).toBe("1728x2304");
  });
  it("rejects over ten references before contacting the provider", () => {
    const reference = { mimeType: "image/jpeg" as const, bytesBase64: "/9j/" };
    expect(() =>
      buildSeedreamRequest({ ...input, references: Array(11).fill(reference) }),
    ).toThrow(/10/);
    expect(
      buildSeedreamRequest({ ...input, references: Array(10).fill(reference) })
        .image,
    ).toHaveLength(10);
  });
});
