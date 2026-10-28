import { useCallback, useEffect, useLayoutEffect, useRef, useState, type UIEventHandler } from 'react';

const BOTTOM_THRESHOLD_PX = 96;

type RequestedScrollBehavior = 'auto' | 'smooth';

interface SmartAutoScrollOptions {
  contentVersion: string;
  enabled?: boolean;
  documentScroll?: boolean;
  resetOnEmpty?: boolean;
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
  enabled = true,
  documentScroll = false,
  resetOnEmpty = false,
  sessionId,
}: SmartAutoScrollOptions): SmartAutoScrollController {
  const containerRef = useRef<HTMLDivElement>(null);
  const followingRef = useRef(true);
  const ignoreScrollEventsUntilRef = useRef(0);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);

  const scrollElementToBottom = useCallback((behavior: RequestedScrollBehavior) => {
    const container = containerRef.current;
    if (!enabled || !container || container.closest('[hidden]')) return;
    if (!documentScroll && typeof container.scrollTo !== 'function') return;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const resolvedBehavior = behavior === 'smooth' && !reduceMotion ? 'smooth' : 'auto';
    if (resolvedBehavior === 'smooth') ignoreScrollEventsUntilRef.current = performance.now() + 750;
    const target = documentScroll ? window : container;
    target.scrollTo({ behavior: resolvedBehavior, top: documentScroll ? document.documentElement.scrollHeight : container.scrollHeight });
  }, [enabled, documentScroll]);

  const scrollToBottom = useCallback((behavior: RequestedScrollBehavior = 'auto') => {
    followingRef.current = true;
    setShowScrollToBottom(false);
    scrollElementToBottom(behavior);
  }, [scrollElementToBottom]);

  const handleScroll = useCallback<UIEventHandler<HTMLDivElement>>((event) => {
    if (!enabled) return;
    if (performance.now() < ignoreScrollEventsUntilRef.current) return;
    const container = event.currentTarget;
    const distanceFromBottom = documentScroll
      ? document.documentElement.scrollHeight - window.innerHeight - window.scrollY
      : container.scrollHeight - container.clientHeight - container.scrollTop;
    const isFollowing = distanceFromBottom <= BOTTOM_THRESHOLD_PX;
    followingRef.current = isFollowing;
    setShowScrollToBottom(!isFollowing);
  }, [enabled, documentScroll]);

  useEffect(() => {
    if (!documentScroll || !enabled) return;
    const scroll = () => {
      const container = containerRef.current;
      if (container && !container.closest('[hidden]')) handleScroll({ currentTarget: container } as React.UIEvent<HTMLDivElement>);
    };
    window.addEventListener('scroll', scroll, { passive: true });
    return () => window.removeEventListener('scroll', scroll);
  }, [documentScroll, enabled, handleScroll]);

  const handleUserScrollIntent = useCallback(() => {
    ignoreScrollEventsUntilRef.current = 0;
  }, []);

  const requestFollow = useCallback((behavior: RequestedScrollBehavior = 'smooth') => {
    scrollToBottom(behavior);
  }, [scrollToBottom]);

  useLayoutEffect(() => {
    followingRef.current = enabled;
    ignoreScrollEventsUntilRef.current = 0;
    if (enabled) scrollElementToBottom('auto');
    else {
      const container = containerRef.current;
      if (documentScroll && resetOnEmpty && container && !container.closest('[hidden]')) window.scrollTo({ behavior:'auto', top:0 });
      else container?.scrollTo?.({ behavior: 'auto', top: 0 });
    }
    const frame = window.requestAnimationFrame(() => setShowScrollToBottom(false));
    return () => window.cancelAnimationFrame(frame);
  }, [enabled, scrollElementToBottom, sessionId, documentScroll, resetOnEmpty]);

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
