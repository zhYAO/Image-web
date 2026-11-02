import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HomeCommerceCarousel } from "@/features/workspace/HomeCommerceCarousel";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
const region = () => screen.getByRole("region", { name: "电商生图" });
const visibleNames = () =>
  screen.getAllByRole("link").map((e) => e.getAttribute("aria-label"));
const pointer = (element: Element, type: string, x: number, y = 50, pointerType = "mouse") =>
  fireEvent(
    element,
    new window.PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      clientX: x,
      clientY: y,
      buttons: 1,
      pointerId: 1,
      pointerType,
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
  it("keeps five unique links mounted and advances by a bounded group of three without an empty tail", () => {
    const { container } = render(<HomeCommerceCarousel />);
    const links = [...container.querySelectorAll("a")];
    expect(links).toHaveLength(5);
    expect(new Set(links.map(e => e.getAttribute("href"))).size).toBe(5);
    expect(links[4]).toHaveAttribute("href", "/create/apparel-catalog");
    expect(visibleNames()).toEqual(["商品套图", "A+ 详情页", "爆款图复刻"]);
    fireEvent.keyDown(region(), { key: "ArrowRight" });
    expect(visibleNames()).toEqual(["爆款图复刻", "AI 商品图", "服装商品图片"]);
    expect(screen.getByText("3–5 / 5")).toBeInTheDocument();
    expect([...container.querySelectorAll("a")]).toEqual(links);
    fireEvent.keyDown(region(), { key: "ArrowLeft" });
    expect(screen.getByText("1–3 / 5")).toBeInTheDocument();
  });
  it("navigates the real scene links with bounded previous and next controls", () => {
    render(<HomeCommerceCarousel />);
    const previous = screen.getByRole("button", { name: "上一组创作场景" });
    const next = screen.getByRole("button", { name: "下一组创作场景" });
    expect(previous).toBeDisabled();
    expect(next).toBeEnabled();
    fireEvent.click(next);
    expect(visibleNames()).toEqual(["爆款图复刻", "AI 商品图", "服装商品图片"]);
    expect(next).toBeDisabled();
    expect(previous).toBeEnabled();
    fireEvent.click(previous);
    expect(visibleNames()).toEqual(["商品套图", "A+ 详情页", "爆款图复刻"]);
    expect(previous).toBeDisabled();
  });
  it("automatically cycles each complete group every six seconds including the overlapping complete final group", () => {
    vi.useFakeTimers();
    const { unmount } = render(<HomeCommerceCarousel />);
    act(() => vi.advanceTimersByTime(5999));
    expect(screen.getByText("1–3 / 5")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1));
    expect(visibleNames()).toEqual(["爆款图复刻", "AI 商品图", "服装商品图片"]);
    act(() => vi.advanceTimersByTime(6000));
    expect(visibleNames()).toEqual(["商品套图", "A+ 详情页", "爆款图复刻"]);
    act(() => vi.advanceTimersByTime(6000));
    expect(screen.getByText("3–5 / 5")).toBeInTheDocument();
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("pauses automatic movement while a scene navigation control has keyboard focus", () => {
    vi.useFakeTimers();
    render(<HomeCommerceCarousel />);
    act(() => screen.getByRole("button", { name: "下一组创作场景" }).focus());
    act(() => vi.advanceTimersByTime(12000));
    expect(visibleNames()).toEqual(["商品套图", "A+ 详情页", "爆款图复刻"]);
    expect(screen.getByRole("button", { name: "下一组创作场景" })).toHaveFocus();
  });
  it("pauses on hover, card focus and hidden tabs, then resumes when each pause ends", () => {
    vi.useFakeTimers();
    render(<HomeCommerceCarousel />);
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
    expect(screen.getByText("3–5 / 5")).toBeInTheDocument();
  });
  it("keeps autoplay paused throughout a vertical pointer contact", () => {
    vi.useFakeTimers();
    render(<HomeCommerceCarousel />);
    const viewport = screen.getByRole("link", { name: "商品套图" }).parentElement!.parentElement!;
    pointer(viewport, "pointerdown", 200, 50, "touch");
    expect(pointer(viewport, "pointermove", 190, 150, "touch")).toBe(true);
    act(() => vi.advanceTimersByTime(7000));
    expect(screen.getByText("1–3 / 5")).toBeInTheDocument();
    expect(pointer(viewport, "pointermove", 80, 150, "touch")).toBe(true);
    pointer(viewport, "pointerup", 80, 150, "touch");
    act(() => vi.advanceTimersByTime(6000));
    expect(screen.getByText("3–5 / 5")).toBeInTheDocument();
  });
  it("disables autoplay for reduced motion while all groups remain keyboard accessible", () => {
    vi.useFakeTimers();
    const change = media();
    change("(prefers-reduced-motion: reduce)", true);
    render(<HomeCommerceCarousel />);
    act(() => vi.advanceTimersByTime(18000));
    expect(screen.getByText("1–3 / 5")).toBeInTheDocument();
    fireEvent.keyDown(region(), { key: "End" });
    expect(visibleNames()).toEqual(["爆款图复刻", "AI 商品图", "服装商品图片"]);
    fireEvent.keyDown(region(), { key: "Home" });
    expect(screen.getByText("1–3 / 5")).toBeInTheDocument();
  });
  it("cycles every card on a narrow viewport without skipping the final workflow", () => {
    vi.useFakeTimers();
    const change = media();
    change("(max-width: 767px)", true);
    render(<HomeCommerceCarousel />);
    const seen = [visibleNames()[0]];
    for (let i = 0; i < 4; i++) {
      act(() => vi.advanceTimersByTime(6000));
      seen.push(visibleNames()[0]);
    }
    expect(seen).toEqual(["商品套图", "A+ 详情页", "爆款图复刻", "AI 商品图", "服装商品图片"]);
    act(() => vi.advanceTimersByTime(6000));
    expect(screen.getByText("1 / 5")).toBeInTheDocument();
  });
  it("keeps the current tail anchor on resize and resumes automatic cycling", () => {
    vi.useFakeTimers();
    const change = media();
    render(<HomeCommerceCarousel />);
    fireEvent.keyDown(region(), { key: "End" });
    change("(max-width: 767px)", true);
    expect(visibleNames()).toEqual(["爆款图复刻"]);
    fireEvent.keyDown(region(), { key: "End" });
    change("(max-width: 767px)", false);
    expect(screen.getByText("3–5 / 5")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(6000));
    expect(screen.getByText("1–3 / 5")).toBeInTheDocument();
  });
  it("snaps horizontal drag by a whole group and suppresses pointer clicks but preserves keyboard activation", () => {
    render(<HomeCommerceCarousel />);
    const viewport = screen.getByRole("link", { name: "商品套图" }).parentElement!.parentElement!;
    pointer(viewport, "pointerdown", 200);
    pointer(viewport, "pointermove", 80);
    pointer(viewport, "pointerup", 80);
    expect(screen.getByText("3–5 / 5")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "AI 商品图" });
    expect(fireEvent.click(link, { detail: 1 })).toBe(false);
    let keyboardPrevented = true;
    link.addEventListener("click", event => { keyboardPrevented = event.defaultPrevented; event.preventDefault(); }, { once: true });
    fireEvent.click(link, { detail: 0 });
    expect(keyboardPrevented).toBe(false);
  });
  it("leaves vertical gestures alone and cancels incomplete horizontal gestures", () => {
    render(<HomeCommerceCarousel />);
    const viewport = screen.getByRole("link", { name: "商品套图" }).parentElement!.parentElement!;
    pointer(viewport, "pointerdown", 200, 50);
    expect(pointer(viewport, "pointermove", 190, 150)).toBe(true);
    pointer(viewport, "pointerup", 190, 150);
    expect(screen.getByText("1–3 / 5")).toBeInTheDocument();
    pointer(viewport, "pointerdown", 200);
    pointer(viewport, "pointermove", 80);
    pointer(viewport, "pointercancel", 80);
    expect(screen.getByText("1–3 / 5")).toBeInTheDocument();
  });
  it("makes a hidden card visible before moving keyboard focus to it", () => {
    const { container } = render(<HomeCommerceCarousel />);
    const links = [...container.querySelectorAll("a")];
    fireEvent.keyDown(region(), { key: "End" });
    act(() => links[4]!.focus());
    let hiddenAtFocus: string | null | undefined;
    links[0]!.addEventListener("focus", () => { hiddenAtFocus = links[0]!.getAttribute("aria-hidden"); });
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
    const viewport = screen.getByRole("link", { name: "商品套图" }).parentElement!.parentElement!;
    pointer(viewport, "pointerdown", 200);
    fireEvent.pointerLeave(viewport, { pointerId: 1 });
    pointer(viewport, "pointerdown", 400);
    pointer(viewport, "pointermove", 280);
    pointer(viewport, "pointerup", 280);
    expect(screen.getByText("3–5 / 5")).toBeInTheDocument();
  });
  it("uses horizontal wheel input to change a whole group without consuming vertical scrolling", () => {
    render(<HomeCommerceCarousel />);
    const viewport = screen.getByRole("link", { name: "商品套图" }).parentElement!.parentElement!;
    fireEvent.wheel(viewport, { deltaX: 80, deltaY: 0 });
    expect(screen.getByText("3–5 / 5")).toBeInTheDocument();
    fireEvent.wheel(viewport, { deltaX: 0, deltaY: 100 });
    expect(screen.getByText("3–5 / 5")).toBeInTheDocument();
  });
});
