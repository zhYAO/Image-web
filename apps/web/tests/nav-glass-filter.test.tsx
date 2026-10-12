import { act, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { NavGlassFilter } from "@/features/workspace/NavGlassFilter";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
it("keeps a readable fallback when the filter capability API is unavailable", () => {
  vi.stubGlobal("CSS", {});
  expect(() =>
    render(
      <header>
        <NavGlassFilter />
      </header>,
    ),
  ).not.toThrow();
});
it("rebuilds a local map only after resizing settles and cancels its pending work on unmount", () => {
  vi.useFakeTimers();
  vi.stubGlobal("CSS", { supports: () => true });
  let width = 800,
    notify = () => {};
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    () => ({
      width,
      height: 56,
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: width,
      bottom: 56,
      toJSON: () => ({}),
    }),
  );
  const disconnect = vi.fn();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: () => void) {
        notify = callback;
      }
      observe() {}
      disconnect = disconnect;
    },
  );
  const { container, unmount } = render(
    <header>
      <NavGlassFilter />
    </header>,
  );
  const image = container.querySelector("feImage")!;
  const map = () =>
    decodeURIComponent(image.getAttribute("href")!.split(",")[1]!);
  expect(map()).toContain('viewBox="0 0 800 56"');
  expect(
    container
      .querySelector("header")!
      .style.getPropertyValue("--z-nav-backdrop"),
  ).toContain("url(");
  width = 600;
  act(() => {
    notify();
    vi.advanceTimersByTime(100);
    notify();
    vi.advanceTimersByTime(139);
  });
  expect(map()).toContain('viewBox="0 0 800 56"');
  act(() => vi.advanceTimersByTime(1));
  expect(map()).toContain('viewBox="0 0 600 56"');
  act(() => notify());
  unmount();
  expect(disconnect).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});
