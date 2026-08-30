import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useSmartAutoScroll } from '@/features/workspace/use-smart-auto-scroll';

let resizeCallback: ResizeObserverCallback | undefined;

class TestResizeObserver {
  constructor(callback: ResizeObserverCallback) {
    resizeCallback = callback;
  }
  disconnect() {}
  observe() {}
  unobserve() {}
}

function Harness({ contentVersion = 0, sessionId = 'session-1' }: { contentVersion?: number; sessionId?: string }) {
  const [sent, setSent] = useState(false);
  const {
    containerRef,
    handleScroll,
    handleUserScrollIntent,
    requestFollow,
    scrollToBottom,
    showScrollToBottom,
  } = useSmartAutoScroll({ contentVersion: `${contentVersion}-${sent}`, sessionId });

  return (
    <>
      <div
        data-testid="scroll-container"
        onPointerDown={handleUserScrollIntent}
        onScroll={handleScroll}
        onTouchMove={handleUserScrollIntent}
        onWheel={handleUserScrollIntent}
        ref={containerRef}
      />
      <button onClick={() => {
        requestFollow('smooth');
        setSent(true);
      }} type="button">发送</button>
      {showScrollToBottom && (
        <button onClick={() => scrollToBottom('smooth')} type="button">回到底部</button>
      )}
    </>
  );
}

function setScrollMetrics(element: HTMLElement, values: { clientHeight: number; scrollHeight: number; scrollTop: number }) {
  for (const [key, value] of Object.entries(values)) {
    Object.defineProperty(element, key, { configurable: true, value, writable: true });
  }
}

describe('useSmartAutoScroll', () => {
  beforeEach(() => {
    resizeCallback = undefined;
    globalThis.ResizeObserver = TestResizeObserver as unknown as typeof ResizeObserver;
  });

  afterEach(() => vi.restoreAllMocks());

  it('pauses content following after the user scrolls away and resumes from the bottom button', () => {
    const { rerender } = render(<Harness />);
    const container = screen.getByTestId('scroll-container');
    const scrollTo = vi.fn();
    Object.defineProperty(container, 'scrollTo', { configurable: true, value: scrollTo });
    setScrollMetrics(container, { clientHeight: 300, scrollHeight: 1_000, scrollTop: 500 });

    fireEvent.scroll(container);
    expect(screen.getByRole('button', { name: '回到底部' })).toBeInTheDocument();

    rerender(<Harness contentVersion={1} />);
    expect(scrollTo).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '回到底部' }));
    expect(scrollTo).toHaveBeenCalledWith({ behavior: 'smooth', top: 1_000 });
    expect(screen.queryByRole('button', { name: '回到底部' })).not.toBeInTheDocument();
  });

  it('keeps following content and height changes while the user remains within 96px of the bottom', () => {
    const { rerender } = render(<Harness />);
    const container = screen.getByTestId('scroll-container');
    const scrollTo = vi.fn();
    Object.defineProperty(container, 'scrollTo', { configurable: true, value: scrollTo });
    setScrollMetrics(container, { clientHeight: 300, scrollHeight: 1_000, scrollTop: 610 });

    fireEvent.scroll(container);
    rerender(<Harness contentVersion={1} />);
    expect(scrollTo).toHaveBeenCalledWith({ behavior: 'auto', top: 1_000 });

    scrollTo.mockClear();
    act(() => resizeCallback?.([], {} as ResizeObserver));
    expect(scrollTo).toHaveBeenCalledWith({ behavior: 'auto', top: 1_000 });
  });

  it('forces a smooth follow for a new user submission and an instant follow when switching sessions', () => {
    const { rerender } = render(<Harness />);
    const container = screen.getByTestId('scroll-container');
    const scrollTo = vi.fn();
    Object.defineProperty(container, 'scrollTo', { configurable: true, value: scrollTo });
    setScrollMetrics(container, { clientHeight: 300, scrollHeight: 1_000, scrollTop: 400 });
    fireEvent.scroll(container);

    fireEvent.click(screen.getByRole('button', { name: '发送' }));
    expect(scrollTo).toHaveBeenCalledWith({ behavior: 'smooth', top: 1_000 });

    scrollTo.mockClear();
    rerender(<Harness sessionId="session-2" />);
    expect(scrollTo).toHaveBeenCalledWith({ behavior: 'auto', top: 1_000 });
  });

  it('uses instant scrolling when reduced motion is requested', () => {
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true } as MediaQueryList);
    render(<Harness />);
    const container = screen.getByTestId('scroll-container');
    const scrollTo = vi.fn();
    Object.defineProperty(container, 'scrollTo', { configurable: true, value: scrollTo });
    setScrollMetrics(container, { clientHeight: 300, scrollHeight: 1_000, scrollTop: 400 });
    fireEvent.scroll(container);

    fireEvent.click(screen.getByRole('button', { name: '回到底部' }));
    expect(scrollTo).toHaveBeenCalledWith({ behavior: 'auto', top: 1_000 });
  });

  it('does not mistake smooth-scroll progress for manual upward scrolling', () => {
    render(<Harness />);
    const container = screen.getByTestId('scroll-container');
    Object.defineProperty(container, 'scrollTo', { configurable: true, value: vi.fn() });
    setScrollMetrics(container, { clientHeight: 300, scrollHeight: 1_000, scrollTop: 400 });
    fireEvent.scroll(container);
    fireEvent.click(screen.getByRole('button', { name: '回到底部' }));

    setScrollMetrics(container, { clientHeight: 300, scrollHeight: 1_000, scrollTop: 520 });
    fireEvent.scroll(container);
    expect(screen.queryByRole('button', { name: '回到底部' })).not.toBeInTheDocument();

    fireEvent.wheel(container, { deltaY: -40 });
    fireEvent.scroll(container);
    expect(screen.getByRole('button', { name: '回到底部' })).toBeInTheDocument();
  });
});
