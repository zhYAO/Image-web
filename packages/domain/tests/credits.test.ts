import { describe, it, expect } from "vitest";
import {
  TRIAL_CREDIT_CATALOG,
  quoteCredits,
  formatCredits,
  imageCreditItem,
  creditConfirmationSchema,
} from "../src/credits";
describe("credit pricing", () => {
  it.each(TRIAL_CREDIT_CATALOG.prices)(
    "quotes $operation $model $resolution in integer units",
    (price) => {
      const { operation, provider, model, resolution, unitMinor } = price;
      const item = { operation, provider, model, resolution };
      const quote = quoteCredits(TRIAL_CREDIT_CATALOG, [{ ...item, count: 3 }]);
      expect(quote.totalMinor).toBe(unitMinor * 3);
      expect(quote.items[0]?.unitMinor).toBe(unitMinor);
    },
  );
  it("quotes mixed selections", () => {
    expect(
      quoteCredits(TRIAL_CREDIT_CATALOG, [
        imageCreditItem({ provider: "seedream", resolution: "2K", count: 2 }),
        { operation: 'chat', provider: 'doubao', model: 'doubao', resolution: '', count: 1 },
      ]).totalMinor,
    ).toBe(62);
  });
  it("does not silently quote unsupported selections as free", () => {
    expect(() =>
      quoteCredits(TRIAL_CREDIT_CATALOG, [
        imageCreditItem({ provider: "seedream", resolution: "1K", count: 1 }),
      ]),
    ).toThrow();
    expect(() =>
      quoteCredits({ ...TRIAL_CREDIT_CATALOG, enabled: false }, []),
    ).toThrow();
  });
  it("formats consistently and rejects fractional confirmations", () => {
    expect(formatCredits(2)).toBe("0.02");
    expect(formatCredits(1000)).toBe("10.00");
    expect(
      creditConfirmationSchema.safeParse({ version: "x", totalMinor: 0.5 })
        .success,
    ).toBe(false);
  });
});
