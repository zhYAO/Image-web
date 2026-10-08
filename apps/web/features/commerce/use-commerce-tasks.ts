import type { CommerceGateway, CommerceTask } from "@zimage/domain";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { unsettledCommerceItem, commerceItemNeedsReview } from "./commerce-ui";
import { nextPollingDelay } from '@/features/workspace/bounded-polling';

export function useCommerceTasks(
  gateway: CommerceGateway | undefined,
  sessionId: string | undefined,
  hasPendingSubmission = false,
  pollTarget: string | false = 'all',
) {
  const [bySession, setBySession] = useState<Record<string, CommerceTask[]>>(
    {},
  );
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const [loaded, setLoaded] = useState<Record<string, boolean>>({});
  const mutationEpoch = useRef(0);
  const inFlight = useRef(new Map<string, Promise<void>>());
  const accept = useCallback((task: CommerceTask) => {
    mutationEpoch.current += 1;
    setBySession((current) => ({
      ...current,
      [task.sessionId]: [
        ...(current[task.sessionId] ?? []).filter(
          (item) => item.id !== task.id,
        ),
        task,
      ].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    }));
  }, []);
  const refresh = useCallback((): Promise<void> => {
    if (!gateway || !sessionId) return Promise.resolve();
    const pending = inFlight.current.get(sessionId);
    if (pending) return pending;
    const epoch = mutationEpoch.current;
    const request = gateway
      .list(sessionId)
      .then((tasks) => {
        // list already reconciles and hydrates the complete task snapshot.
        if (epoch === mutationEpoch.current)
          setBySession((current) => ({
            ...current,
            [sessionId]: tasks.filter((task) => task.sessionId === sessionId),
          }));
        setErrors((current) => ({ ...current, [sessionId]: undefined }));
      })
      .catch((cause: unknown) => {
        setErrors((current) => ({
          ...current,
          [sessionId]:
            cause instanceof Error
              ? cause.message
              : "电商任务载入失败，请重试。",
        }));
        throw cause;
      })
      .finally(() => {
        setLoaded((current) => ({ ...current, [sessionId]: true }));
        inFlight.current.delete(sessionId);
      });
    inFlight.current.set(sessionId, request);
    return request;
  }, [gateway, sessionId]);
  const tasks = sessionId ? (bySession[sessionId] ?? []) : [];
  const pendingSince = useMemo(() => hasPendingSubmission ? new Date().toISOString() : undefined,
    [hasPendingSubmission]);
  const polledTasks = pollTarget === false ? [] : pollTarget === 'all' ? tasks :
    pollTarget === 'latest' ? tasks.slice(-1) : tasks.filter(task => task.id === pollTarget);
  const activeSinceKey = [
    ...polledTasks.flatMap(task => task.runs.filter(run => run.items.some(item =>
      unsettledCommerceItem(item) && !commerceItemNeedsReview(item))).map(run => run.createdAt)),
    ...(pendingSince && pollTarget !== false ? [pendingSince] : []),
  ].join('|');
  useEffect(() => {
    void refresh().catch(() => undefined);
  }, [refresh]);
  useEffect(() => {
    if (!gateway || !sessionId) return;
    let stopped = false;
    let timer: number | undefined;
    const dueDelay = () => Math.min(...activeSinceKey.split('|').filter(Boolean).map(createdAt => nextPollingDelay(createdAt, 'commerce'))
      .filter((value): value is number => value !== null));
    const pollVisible = () => {
      if (document.visibilityState !== 'hidden' && Number.isFinite(dueDelay()))
        void refresh().catch(() => undefined);
    };
    const schedule = () => {
      const delay = dueDelay();
      if (!Number.isFinite(delay) || stopped) return;
      timer = window.setTimeout(async () => {
        if (Number.isFinite(dueDelay()) && document.visibilityState !== 'hidden') await refresh().catch(() => undefined);
        schedule();
      }, delay);
    };
    schedule();
    window.addEventListener("focus", pollVisible);
    document.addEventListener("visibilitychange", pollVisible);
    return () => {
      stopped = true;
      if (timer !== undefined) window.clearTimeout(timer);
      window.removeEventListener("focus", pollVisible);
      document.removeEventListener("visibilitychange", pollVisible);
    };
  }, [gateway, sessionId, activeSinceKey, refresh]);
  return {
    tasks,
    cachedTasks: Object.values(bySession).flat(),
    accept,
    error: sessionId ? errors[sessionId] : undefined,
    loading: Boolean(gateway && sessionId && !loaded[sessionId]),
    refresh,
  };
}
