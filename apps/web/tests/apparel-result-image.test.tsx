import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Image } from "antd";
import { ApparelResultImage } from "@/features/commerce/ApparelResultImage";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
describe("private apparel result visibility", () => {
  beforeEach(() =>
    vi.stubEnv("NEXT_PUBLIC_APPAREL_VISIBLE_LOADING_ENABLED", "true"),
  );
  it("keeps the original image path in production despite a true public opt-in", () => {
    vi.stubEnv("NODE_ENV", "production");
    const Observer = vi.fn();
    vi.stubGlobal("IntersectionObserver", Observer);
    render(<ApparelResultImage url="/private/production" name="生产原图" />);
    expect(screen.getByRole("img", { name: "生产原图" })).toHaveAttribute(
      "src",
      "/private/production",
    );
    expect(Observer).not.toHaveBeenCalled();
  });
  it("keeps deferred originals in the full gallery without mounting their thumbnails", async () => {
    vi.stubGlobal(
      "IntersectionObserver",
      vi.fn(function () {
        return { observe: vi.fn(), disconnect: vi.fn() };
      }),
    );
    render(
      <Image.PreviewGroup items={["/private/first", "/private/last"]}>
        <ApparelResultImage url="/private/first" name="首图" />
        <ApparelResultImage url="/private/last" name="末图" />
      </Image.PreviewGroup>,
    );
    expect(screen.queryByRole("img")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "加载 首图" }));
    expect(screen.queryByRole("img", { name: "末图" })).toBeNull();
    fireEvent.click(screen.getByRole("img", { name: "首图" }));
    await waitFor(() => expect(screen.getByText("1 / 2")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "right" }));
    await waitFor(() => expect(screen.getByText("2 / 2")).toBeInTheDocument());
    expect(document.querySelector(".ant-image-preview-img")).toHaveAttribute(
      "src",
      "/private/last",
    );
  });
  it("loads automatically when IntersectionObserver is unavailable", async () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    render(<ApparelResultImage url="/private/fallback" name="兼容预览" />);
    await waitFor(() =>
      expect(screen.getByRole("img", { name: "兼容预览" })).toHaveAttribute(
        "src",
        "/private/fallback",
      ),
    );
  });
  it("resets visibility on URL replacement and ignores the stale observer", () => {
    const callbacks: IntersectionObserverCallback[] = [];
    vi.stubGlobal(
      "IntersectionObserver",
      vi.fn(function (callback) {
        callbacks.push(callback);
        return { observe: vi.fn(), disconnect: vi.fn() };
      }),
    );
    const view = render(<ApparelResultImage url="/private/old" name="旧图" />);
    act(() =>
      callbacks[0]!(
        [{ isIntersecting: true }] as IntersectionObserverEntry[],
        {} as IntersectionObserver,
      ),
    );
    expect(screen.getByRole("img", { name: "旧图" })).toBeInTheDocument();
    view.rerender(<ApparelResultImage url="/private/new" name="新图" />);
    expect(screen.queryByRole("img")).toBeNull();
    act(() =>
      callbacks[0]!(
        [{ isIntersecting: true }] as IntersectionObserverEntry[],
        {} as IntersectionObserver,
      ),
    );
    expect(screen.queryByRole("img")).toBeNull();
    act(() =>
      callbacks[1]!(
        [
          { isIntersecting: true, intersectionRatio: 0.001 },
        ] as IntersectionObserverEntry[],
        {} as IntersectionObserver,
      ),
    );
    expect(screen.getByRole("img", { name: "新图" })).toHaveAttribute(
      "src",
      "/private/new",
    );
  });
  it.each([undefined, "false"])(
    "mounts the original without observer when disabled: %s",
    (value) => {
      vi.stubEnv("NEXT_PUBLIC_APPAREL_VISIBLE_LOADING_ENABLED", value);
      const Observer = vi.fn();
      vi.stubGlobal("IntersectionObserver", Observer);
      render(<ApparelResultImage url="/private/baseline" name="原图" />);
      expect(screen.getByRole("img", { name: "原图" })).toHaveAttribute(
        "src",
        "/private/baseline",
      );
      expect(Observer).not.toHaveBeenCalled();
    },
  );
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
