import { describe, expect, it } from "vitest";
import { resolveImageModel, TRIAL_CREDIT_CATALOG, quoteCredits } from "../src";

describe("Seedream 5.0 availability and billing", () => {
  it("defaults Seedream submissions to Plan Pro without reusing the standard Pro identity", () => {
    expect(resolveImageModel({ provider: "seedream" }).model).toBe(
      "doubao-seedream-5.0-pro",
    );
    expect(
      resolveImageModel({ provider: "seedream", model: "doubao-seedream-5.0-pro" })
        .capability.resolutions,
    ).toEqual(["2K"]);
    expect(() =>
      resolveImageModel({ provider: "seedream", model: "seedream-4.5" }),
    ).toThrow();
  });
  it("quotes new Plan images using their distinct billing identity", () => {
    const quote = quoteCredits(TRIAL_CREDIT_CATALOG, [
      {
        operation: "image",
        provider: "seedream",
        model: "doubao-seedream-5.0-pro",
        resolution: "2K",
        count: 2,
      },
      {
        operation: "image",
        provider: "seedream",
        model: "doubao-seedream-5.0-pro",
        resolution: "2K",
        count: 1,
      },
    ]);
    expect(quote.totalMinor).toBe(90);
    expect(quote.items.map((item) => item.model)).toEqual([
      "doubao-seedream-5.0-pro",
      "doubao-seedream-5.0-pro",
    ]);
  });
});
