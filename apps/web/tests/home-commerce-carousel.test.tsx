import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HomeCommerceCarousel } from "@/features/workspace/HomeCommerceCarousel";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
const next = () => screen.getByRole("button", { name: "下一张电商功能" });
const previous = () => screen.getByRole("button", { name: "上一张电商功能" });
const region = () => screen.getByRole("region", { name: "电商生图" });
const visibleNames = () =>
  screen.getAllByRole("link").map((e) => e.getAttribute("aria-label"));
const pointer = (element: Element, type: string, x: number, y = 50) =>
  fireEvent(
    element,
    new window.PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      clientX: x,
      clientY: y,
      buttons: 1,
      pointerId: 1,
      pointerType: "mouse",
    }),
  );
function media() {
  const values = new Map<string, boolean>();
  const listeners = new Map<string, Set<() => void>>();
  vi.spyOn(window, "matchMedia").mockImplementation(
    (query) =>
      ({
        matches: values.get(query) ?? false,
        media: query,
        onchange: null,
        addEventListener: (_type: string, callback: () => void) => {
          if (!listeners.has(query)) listeners.set(query, new Set());
          listeners.get(query)!.add(callback);
        },
        removeEventListener: (_type: string, callback: () => void) =>
          listeners.get(query)?.delete(callback),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList,
  );
  return (query: string, value: boolean) =>
    act(() => {
      values.set(query, value);
      listeners.get(query)?.forEach((callback) => callback());
    });
}
describe("home commerce carousel", () => {
  it("keeps five unique workflow links mounted while moving one card at a time", () => {
    const { container } = render(<HomeCommerceCarousel />);
    const links = [...container.querySelectorAll("a")];
    expect(links).toHaveLength(5);
    expect(new Set(links.map((e) => e.getAttribute("href"))).size).toBe(5);
    expect(links[4]).toHaveAttribute("href", "/create/apparel-catalog");
    expect(visibleNames()).toEqual(["商品套图", "A+ 详情页", "爆款图复刻"]);
    fireEvent.click(next());
    expect(visibleNames()).toEqual(["A+ 详情页", "爆款图复刻", "AI 商品图"]);
    expect(screen.getByText("2–4 / 5")).toBeInTheDocument();
    expect([...container.querySelectorAll("a")]).toEqual(links);
    fireEvent.click(previous());
    expect([...container.querySelectorAll("a")]).toEqual(links);
    expect(screen.getByText("1–3 / 5")).toBeInTheDocument();
  });
  it("stops at both ends and supports arrows, Home and End without losing control focus", () => {
    render(<HomeCommerceCarousel />);
    expect(previous()).toBeDisabled();
    act(() => next().focus());
    fireEvent.click(next());
    expect(next()).toHaveFocus();
    fireEvent.keyDown(region(), { key: "End" });
    expect(next()).toBeDisabled();
    expect(screen.getByText("3–5 / 5")).toBeInTheDocument();
    fireEvent.keyDown(region(), { key: "ArrowLeft" });
    expect(screen.getByText("2–4 / 5")).toBeInTheDocument();
    fireEvent.keyDown(region(), { key: "Home" });
    expect(previous()).toBeDisabled();
    fireEvent.keyDown(region(), { key: "ArrowRight" });
    expect(screen.getByText("2–4 / 5")).toBeInTheDocument();
  });
  it("defaults to manual, plays every six seconds only on request and stops at the end", () => {
    vi.useFakeTimers();
    const { unmount } = render(<HomeCommerceCarousel />);
    act(() => vi.advanceTimersByTime(18000));
    expect(screen.getByText("1–3 / 5")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "播放电商功能" }));
    act(() => vi.advanceTimersByTime(5999));
    expect(screen.getByText("1–3 / 5")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByText("2–4 / 5")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(6000));
    expect(screen.getByText("3–5 / 5")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "播放电商功能" })).toBeDisabled();
    act(() => vi.advanceTimersByTime(12000));
    expect(screen.getByText("3–5 / 5")).toBeInTheDocument();
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("pauses requested playback while hovered, focused on a card or in a hidden tab", () => {
    vi.useFakeTimers();
    render(<HomeCommerceCarousel />);
    fireEvent.click(screen.getByRole("button", { name: "播放电商功能" }));
    fireEvent.mouseEnter(region());
    act(() => vi.advanceTimersByTime(7000));
    expect(screen.getByText("1–3 / 5")).toBeInTheDocument();
    fireEvent.mouseLeave(region());
    const link = screen.getByRole("link", { name: "商品套图" });
    act(() => link.focus());
    act(() => vi.advanceTimersByTime(7000));
    expect(screen.getByText("1–3 / 5")).toBeInTheDocument();
    act(() => link.blur());
    const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    fireEvent(document, new Event("visibilitychange"));
    act(() => vi.advanceTimersByTime(7000));
    expect(screen.getByText("1–3 / 5")).toBeInTheDocument();
    hidden.mockReturnValue(false);
    fireEvent(document, new Event("visibilitychange"));
    act(() => vi.advanceTimersByTime(6000));
    expect(screen.getByText("2–4 / 5")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "暂停电商功能" }));
    act(() => vi.advanceTimersByTime(7000));
    expect(screen.getByText("2–4 / 5")).toBeInTheDocument();
  });
  it("preserves the anchor on narrow resize and disables playback for reduced motion", () => {
    const change = media();
    render(<HomeCommerceCarousel />);
    fireEvent.click(next());
    change("(max-width: 767px)", true);
    expect(visibleNames()).toEqual(["A+ 详情页"]);
    expect(screen.getByText("2 / 5")).toBeInTheDocument();
    fireEvent.keyDown(region(), { key: "End" });
    expect(screen.getByText("5 / 5")).toBeInTheDocument();
    change("(max-width: 767px)", false);
    expect(screen.getByText("3–5 / 5")).toBeInTheDocument();
    fireEvent.keyDown(region(), { key: "Home" });
    change("(prefers-reduced-motion: reduce)", true);
    expect(screen.getByRole("button", { name: "播放电商功能" })).toBeDisabled();
    fireEvent.click(next());
    expect(screen.getByText("2–4 / 5")).toBeInTheDocument();
  });
  it("snaps a horizontal drag and suppresses its pointer click while preserving keyboard activation", () => {
    render(<HomeCommerceCarousel />);
    const viewport = screen.getByRole("link", { name: "商品套图" })
      .parentElement!.parentElement!;
    pointer(viewport, "pointerdown", 200);
    pointer(viewport, "pointermove", 80);
    pointer(viewport, "pointerup", 80);
    expect(screen.getByText("2–4 / 5")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "A+ 详情页" });
    expect(fireEvent.click(link, { detail: 1 })).toBe(false);
    let keyboardPrevented = true;
    link.addEventListener(
      "click",
      (event) => {
        keyboardPrevented = event.defaultPrevented;
        event.preventDefault();
      },
      { once: true },
    );
    fireEvent.click(link, { detail: 0 });
    expect(keyboardPrevented).toBe(false);
  });
  it("leaves vertical gestures alone and cancels incomplete horizontal gestures", () => {
    render(<HomeCommerceCarousel />);
    const viewport = screen.getByRole("link", { name: "商品套图" })
      .parentElement!.parentElement!;
    pointer(viewport, "pointerdown", 200, 50);
    expect(pointer(viewport, "pointermove", 190, 150)).toBe(true);
    pointer(viewport, "pointerup", 190, 150);
    expect(screen.getByText("1–3 / 5")).toBeInTheDocument();
    pointer(viewport, "pointerdown", 200);
    pointer(viewport, "pointermove", 80);
    pointer(viewport, "pointercancel", 80);
    expect(screen.getByText("1–3 / 5")).toBeInTheDocument();
  });
  it("makes a previously hidden card visible before moving keyboard focus to it", () => {
    const { container } = render(<HomeCommerceCarousel />);
    const links = [...container.querySelectorAll("a")];
    fireEvent.keyDown(region(), { key: "End" });
    act(() => links[4]!.focus());
    let hiddenAtFocus: string | null | undefined;
    links[0]!.addEventListener("focus", () => {
      hiddenAtFocus = links[0]!.getAttribute("aria-hidden");
    });
    fireEvent.keyDown(links[4]!, { key: "Home" });
    expect(hiddenAtFocus).toBe("false");
    expect(links[0]).toHaveFocus();
  });
  it("moves focus to a visible card when resizing hides the focused card", () => {
    const change = media();
    const { container } = render(<HomeCommerceCarousel />);
    const links = [...container.querySelectorAll("a")];
    act(() => links[2]!.focus());
    change("(max-width: 767px)", true);
    expect(links[0]).toHaveFocus();
    expect(links[0]).toHaveAttribute("aria-hidden", "false");
  });
  it("abandons an uncaptured gesture on leaving and accepts the next drag", () => {
    render(<HomeCommerceCarousel />);
    const viewport = screen.getByRole("link", { name: "商品套图" })
      .parentElement!.parentElement!;
    pointer(viewport, "pointerdown", 200);
    fireEvent.pointerLeave(viewport, { pointerId: 1 });
    pointer(viewport, "pointerdown", 400);
    pointer(viewport, "pointermove", 280);
    pointer(viewport, "pointerup", 280);
    expect(screen.getByText("2–4 / 5")).toBeInTheDocument();
  });
  it("stops playback when a resize reaches the new end and does not resume on narrowing", () => {
    vi.useFakeTimers();
    const change = media();
    change("(max-width: 767px)", true);
    render(<HomeCommerceCarousel />);
    fireEvent.click(next());
    fireEvent.click(next());
    fireEvent.click(screen.getByRole("button", { name: "播放电商功能" }));
    change("(max-width: 767px)", false);
    expect(screen.getByRole("button", { name: "播放电商功能" })).toBeDisabled();
    change("(max-width: 767px)", true);
    act(() => vi.advanceTimersByTime(12000));
    expect(screen.getByText("3 / 5")).toBeInTheDocument();
  });
});
