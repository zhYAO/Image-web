import { describe, expect, it } from "vitest";
import { resolveImageModel, TRIAL_CREDIT_CATALOG, quoteCredits } from "../src";

describe("Seedream 5.0 availability and billing", () => {
  it("defaults Seedream submissions to Flash and allows choosing Pro", () => {
    expect(resolveImageModel({ provider: "seedream" }).model).toBe(
      "seedream-5.0-flash",
    );
    expect(
      resolveImageModel({ provider: "seedream", model: "seedream-5.0-pro" })
        .capability.resolutions,
    ).toEqual(["2K"]);
    expect(() =>
      resolveImageModel({ provider: "seedream", model: "seedream-4.5" }),
    ).toThrow();
  });
  it("quotes each new model without conflating their billing identities", () => {
    const quote = quoteCredits(TRIAL_CREDIT_CATALOG, [
      {
        operation: "image",
        provider: "seedream",
        model: "seedream-5.0-flash",
        resolution: "2K",
        count: 2,
      },
      {
        operation: "image",
        provider: "seedream",
        model: "seedream-5.0-pro",
        resolution: "2K",
        count: 1,
      },
    ]);
    expect(quote.totalMinor).toBe(90);
    expect(quote.items.map((item) => item.model)).toEqual([
      "seedream-5.0-flash",
      "seedream-5.0-pro",
    ]);
  });
});
