import type { CommerceGateway, CommerceTask } from "@zimage/domain";
import { useCallback, useEffect, useRef, useState } from "react";
import { unsettledCommerceItem, commerceItemNeedsReview } from "./commerce-ui";

export function useCommerceTasks(
  gateway: CommerceGateway | undefined,
  sessionId: string | undefined,
  hasPendingSubmission = false,
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
  const active =
    hasPendingSubmission ||
    tasks.some((task) =>
      task.runs.some((run) =>
        run.items.some(
          (item) =>
            unsettledCommerceItem(item) && !commerceItemNeedsReview(item),
        ),
      ),
    );
  useEffect(() => {
    void refresh().catch(() => undefined);
  }, [refresh]);
  useEffect(() => {
    if (!gateway || !sessionId) return;
    const pollVisible = () => {
      if (document.visibilityState !== "hidden")
        void refresh().catch(() => undefined);
    };
    const timer = window.setInterval(pollVisible, active ? 1500 : 30_000);
    window.addEventListener("focus", pollVisible);
    document.addEventListener("visibilitychange", pollVisible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", pollVisible);
      document.removeEventListener("visibilitychange", pollVisible);
    };
  }, [gateway, sessionId, active, refresh]);
  return {
    tasks,
    cachedTasks: Object.values(bySession).flat(),
    accept,
    error: sessionId ? errors[sessionId] : undefined,
    loading: Boolean(gateway && sessionId && !loaded[sessionId]),
    refresh,
  };
}
