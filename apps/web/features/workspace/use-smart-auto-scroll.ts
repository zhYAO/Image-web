import { useCallback, useEffect, useLayoutEffect, useRef, useState, type UIEventHandler } from 'react';

const BOTTOM_THRESHOLD_PX = 96;

type RequestedScrollBehavior = 'auto' | 'smooth';

interface SmartAutoScrollOptions {
  contentVersion: string;
  sessionId?: string;
}

interface SmartAutoScrollController {
  containerRef: React.RefObject<HTMLDivElement | null>;
  handleScroll: UIEventHandler<HTMLDivElement>;
  handleUserScrollIntent: () => void;
  requestFollow: (behavior?: RequestedScrollBehavior) => void;
  scrollToBottom: (behavior?: RequestedScrollBehavior) => void;
  showScrollToBottom: boolean;
}

export function useSmartAutoScroll({
  contentVersion,
  sessionId,
}: SmartAutoScrollOptions): SmartAutoScrollController {
  const containerRef = useRef<HTMLDivElement>(null);
  const followingRef = useRef(true);
  const ignoreScrollEventsUntilRef = useRef(0);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);

  const scrollElementToBottom = useCallback((behavior: RequestedScrollBehavior) => {
    const container = containerRef.current;
    if (!container || typeof container.scrollTo !== 'function') return;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const resolvedBehavior = behavior === 'smooth' && !reduceMotion ? 'smooth' : 'auto';
    if (resolvedBehavior === 'smooth') ignoreScrollEventsUntilRef.current = performance.now() + 750;
    container.scrollTo({
      behavior: resolvedBehavior,
      top: container.scrollHeight,
    });
  }, []);

  const scrollToBottom = useCallback((behavior: RequestedScrollBehavior = 'auto') => {
    followingRef.current = true;
    setShowScrollToBottom(false);
    scrollElementToBottom(behavior);
  }, [scrollElementToBottom]);

  const handleScroll = useCallback<UIEventHandler<HTMLDivElement>>((event) => {
    if (performance.now() < ignoreScrollEventsUntilRef.current) return;
    const container = event.currentTarget;
    const distanceFromBottom = container.scrollHeight - container.clientHeight - container.scrollTop;
    const isFollowing = distanceFromBottom <= BOTTOM_THRESHOLD_PX;
    followingRef.current = isFollowing;
    setShowScrollToBottom(!isFollowing);
  }, []);

  const handleUserScrollIntent = useCallback(() => {
    ignoreScrollEventsUntilRef.current = 0;
  }, []);

  const requestFollow = useCallback((behavior: RequestedScrollBehavior = 'smooth') => {
    scrollToBottom(behavior);
  }, [scrollToBottom]);

  useLayoutEffect(() => {
    followingRef.current = true;
    ignoreScrollEventsUntilRef.current = 0;
    scrollElementToBottom('auto');
    const frame = window.requestAnimationFrame(() => setShowScrollToBottom(false));
    return () => window.cancelAnimationFrame(frame);
  }, [scrollElementToBottom, sessionId]);

  useEffect(() => {
    if (followingRef.current) scrollElementToBottom('auto');
  }, [contentVersion, scrollElementToBottom]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver(() => {
      if (followingRef.current) scrollElementToBottom('auto');
    });
    observer.observe(container);
    if (container.firstElementChild) observer.observe(container.firstElementChild);
    return () => observer.disconnect();
  }, [scrollElementToBottom]);

  return {
    containerRef,
    handleScroll,
    handleUserScrollIntent,
    requestFollow,
    scrollToBottom,
    showScrollToBottom,
  };
}
