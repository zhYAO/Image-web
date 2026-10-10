import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HomeCommerceCarousel } from "@/features/workspace/HomeCommerceCarousel";

afterEach(() => vi.useRealTimers());
const names = () =>
  screen.getAllByRole("link").map((link) => link.getAttribute("aria-label"));
describe("home commerce carousel", () => {
  it("cycles two groups and links to all five scene workflows", () => {
    render(<HomeCommerceCarousel />);
    expect(names()).toEqual(["商品套图", "A+ 详情页", "爆款图复刻"]);
    expect(screen.getByRole("link", { name: "商品套图" })).toHaveAttribute(
      "href",
      "/create/product-set",
    );
    fireEvent.click(screen.getByRole("button", { name: "下一组电商功能" }));
    expect(names()).toEqual(["AI 商品图", "服装商品图片", "商品套图"]);
    expect(screen.getByRole('link',{name:'服装商品图片'})).toHaveAttribute('href','/create/apparel-catalog');
    fireEvent.click(screen.getByRole("button", { name: "下一组电商功能" }));
    expect(names()).toEqual(["商品套图", "A+ 详情页", "爆款图复刻"]);
    fireEvent.click(screen.getByRole("button", { name: "下一组电商功能" }));
    expect(names()[0]).toBe("AI 商品图");
    fireEvent.click(screen.getByRole("button", { name: "上一组电商功能" }));
    expect(names()[0]).toBe("商品套图");
  });
  it("waits five seconds, pauses while hovered or focused, restarts and cleans up", () => {
    vi.useFakeTimers();
    const { unmount } = render(<HomeCommerceCarousel />);
    act(() => vi.advanceTimersByTime(4999));
    expect(names()[0]).toBe("商品套图");
    act(() => vi.advanceTimersByTime(1));
    expect(names()[0]).toBe("AI 商品图");
    const region = screen.getByRole("region", { name: "电商生图" });
    fireEvent.mouseEnter(region);
    act(() => vi.advanceTimersByTime(10000));
    expect(names()[0]).toBe("AI 商品图");
    fireEvent.mouseLeave(region);
    act(() => screen.getByRole("button", { name: "下一组电商功能" }).focus());
    act(() => vi.advanceTimersByTime(10000));
    expect(names()[0]).toBe("AI 商品图");
    fireEvent.blur(region, { relatedTarget: document.body });
    act(() => vi.advanceTimersByTime(5000));
    expect(names()[0]).toBe("商品套图");
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});

it("pauses in hidden tabs and restarts a full interval after returning", () => {
  vi.useFakeTimers();
  render(<HomeCommerceCarousel />);
  const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(true);
  fireEvent(document, new Event("visibilitychange"));
  act(() => vi.advanceTimersByTime(15000));
  expect(names()[0]).toBe("商品套图");
  hidden.mockReturnValue(false);
  fireEvent(document, new Event("visibilitychange"));
  act(() => vi.advanceTimersByTime(4999));
  expect(names()[0]).toBe("商品套图");
  act(() => vi.advanceTimersByTime(1));
  expect(names()[0]).toBe("AI 商品图");
  hidden.mockRestore();
});

it("respects reduced motion and uses single cards on narrow screens", () => {
  vi.useFakeTimers();
  const original = window.matchMedia;
  vi.spyOn(window, "matchMedia").mockImplementation((query) => ({
    ...original(query),
    matches: true,
  }));
  render(<HomeCommerceCarousel />);
  expect(names()).toEqual(["商品套图"]);
  act(() => vi.advanceTimersByTime(15000));
  expect(names()).toEqual(["商品套图"]);
  fireEvent.click(screen.getByRole("button", { name: "下一组电商功能" }));
  expect(names()).toEqual(["A+ 详情页"]);
  vi.restoreAllMocks();
});

it("swipes horizontally without following the card link, and ignores vertical gestures", () => {
  render(<HomeCommerceCarousel />);
  const viewport = screen.getByRole("link", { name: "商品套图" }).parentElement!
    .parentElement!;
  const pointer = (type: string, x: number, y: number) =>
    fireEvent(
      viewport,
      new MouseEvent(type, { bubbles: true, clientX: x, clientY: y }),
    );
  pointer("pointerdown", 200, 50);
  pointer("pointerup", 100, 55);
  expect(names()[0]).toBe("AI 商品图");
  expect(fireEvent.click(screen.getByRole("link", { name: "AI 商品图" }))).toBe(
    false,
  );
  pointer("pointerdown", 200, 50);
  pointer("pointerup", 190, 140);
  expect(names()[0]).toBe("AI 商品图");
});

it("resumes autoplay if swiping removes the focused card", () => {
  vi.useFakeTimers();
  render(<HomeCommerceCarousel />);
  const link = screen.getByRole("link", { name: "商品套图" });
  act(() => link.focus());
  const viewport = link.parentElement!.parentElement!;
  fireEvent(
    viewport,
    new MouseEvent("pointerdown", { bubbles: true, clientX: 200, clientY: 50 }),
  );
  fireEvent(
    viewport,
    new MouseEvent("pointerup", { bubbles: true, clientX: 100, clientY: 50 }),
  );
  expect(names()[0]).toBe("AI 商品图");
  act(() => vi.advanceTimersByTime(5000));
  expect(names()[0]).toBe("商品套图");
});
