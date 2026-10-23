import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LandingPage } from "@/features/brand/landing/LandingPage";
import { HeroGallery } from "@/features/brand/landing/HeroGallery";
import { ComposerOrbs } from "@/features/workspace/ComposerOrbs";
import { GALLERY_INTERVAL_MS } from "@/features/brand/landing/motion";

class Observer {
  static instances: Observer[] = [];
  callback: IntersectionObserverCallback;
  disconnect = vi.fn();
  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
    Observer.instances.push(this);
  }
  observe() {}
  emit(visible: boolean) {
    this.callback(
      [
        {
          isIntersecting: visible,
          intersectionRatio: visible ? 1 : 0,
        } as IntersectionObserverEntry,
      ],
      this as unknown as IntersectionObserver,
    );
  }
}

describe("integrated brand interactions", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    Observer.instances = [];
  });
  it("links the full brand page to the single workspace and closes the keyboard navigation", () => {
    render(<LandingPage />);
    const starts = screen.getAllByRole("link", { name: /开始创作/ });
    expect(starts.length).toBeGreaterThan(0);
    for (const link of starts) expect(link).toHaveAttribute("href", "/");
    expect(screen.getAllByRole("link", { name: /资产库/ })[0]).toHaveAttribute(
      "href",
      "/assets",
    );
    fireEvent.click(screen.getByRole("button", { name: "打开导航" }));
    const close = screen.getByRole("button", { name: "关闭导航" });
    expect(close).toHaveAttribute("aria-expanded", "true");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getByRole("button", { name: "打开导航" })).toHaveFocus();
    expect(screen.getByText("这里会真的生成图片吗？")).toBeInTheDocument();
  });
  it("pauses a visible gallery on user request and disposes its observer", () => {
    vi.useFakeTimers();
    vi.stubGlobal("IntersectionObserver", Observer);
    const { unmount } = render(<HeroGallery />);
    const observer = Observer.instances[0]!;
    act(() => observer.emit(true));
    const group = screen.getByRole("group", { name: "切换创作示例" });
    const selected = () =>
      within(group)
        .getAllByRole("button")
        .find((button) => button.getAttribute("aria-pressed") === "true")
        ?.textContent;
    const first = selected();
    act(() => vi.advanceTimersByTime(GALLERY_INTERVAL_MS));
    expect(selected()).not.toBe(first);
    fireEvent.click(screen.getByRole("button", { name: "暂停自动切换" }));
    const paused = selected();
    act(() => vi.advanceTimersByTime(GALLERY_INTERVAL_MS * 2));
    expect(selected()).toBe(paused);
    unmount();
    expect(observer.disconnect).toHaveBeenCalledOnce();
  });
  it("pauses decorative orbs while composing and disconnects on unmount", () => {
    vi.stubGlobal("IntersectionObserver", Observer);
    const view = render(<ComposerOrbs focused={false} />);
    act(() => Observer.instances[0]!.emit(true));
    expect(view.container.firstElementChild).toHaveAttribute(
      "data-running",
      "true",
    );
    view.rerender(<ComposerOrbs focused />);
    expect(view.container.firstElementChild).toHaveAttribute(
      "data-running",
      "false",
    );
    view.unmount();
    expect(Observer.instances[0]!.disconnect).toHaveBeenCalledOnce();
  });
});
