import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApparelResultImage } from "@/features/commerce/ApparelResultImage";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
describe("private apparel result visibility", () => {
  it("keeps the original URL out of images until the nested preview becomes visible", () => {
    let intersect!: IntersectionObserverCallback;
    const observe = vi.fn(),
      disconnect = vi.fn();
    const Observer = vi.fn(function (callback, options) {
      intersect = callback;
      expect(options).toMatchObject({ rootMargin: "160px", root: null });
      return { observe, disconnect };
    });
    vi.stubGlobal("IntersectionObserver", Observer);
    render(<ApparelResultImage url="/private/original-a" name="主图/1.jpg" />);
    // The scroll root and viewport are both considered by native IntersectionObserver.
    expect(screen.queryByRole("img")).toBeNull();
    expect(observe).toHaveBeenCalledTimes(1);
    act(() =>
      intersect(
        [{ isIntersecting: false }] as IntersectionObserverEntry[],
        {} as IntersectionObserver,
      ),
    );
    expect(screen.queryByRole("img")).toBeNull();
    act(() =>
      intersect(
        [{ isIntersecting: true }] as IntersectionObserverEntry[],
        {} as IntersectionObserver,
      ),
    );
    expect(screen.getByRole("img", { name: "主图/1.jpg" })).toHaveAttribute(
      "src",
      "/private/original-a",
    );
    fireEvent.click(screen.getByRole("img", { name: "主图/1.jpg" }));
    expect(disconnect).toHaveBeenCalled();
  });
  it("uses a viewport observer so the mobile document scroll and desktop clipped aside both gate visibility", () => {
    const Observer = vi.fn(function () {
      return { observe: vi.fn(), disconnect: vi.fn() };
    });
    vi.stubGlobal("IntersectionObserver", Observer);
    const view = render(<ApparelResultImage url="/private/a" name="A" />);
    view.rerender(<ApparelResultImage url="/private/b" name="B" />);
    expect(screen.queryByRole("img")).toBeNull();
    view.unmount();
    expect(Observer).toHaveBeenCalled();
  });
});
