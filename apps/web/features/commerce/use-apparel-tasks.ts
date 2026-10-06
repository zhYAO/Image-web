import { useCallback, useEffect, useRef, useState } from "react";
import type { ApparelTask, ApparelGateway } from "@zimage/domain";
export function useApparelTasks(
  gateway: ApparelGateway | undefined,
  sessionId: string | undefined,
) {
  const [state, setState] = useState<{
    sessionId?: string;
    tasks: ApparelTask[];
    loading: boolean;
    error?: string;
  }>({ tasks: [], loading: Boolean(gateway && sessionId) });
  const epoch = useRef(0);
  const accept = useCallback((task: ApparelTask) => {
    epoch.current++;
    setState((current) => ({
      sessionId: task.sessionId,
      loading: false,
      tasks: [
        ...(current.sessionId === task.sessionId ? current.tasks : []).filter(
          (item) => item.id !== task.id,
        ),
        task,
      ],
    }));
  }, []);
  const refresh = useCallback(async () => {
    if (!gateway || !sessionId) return;
    const version = ++epoch.current;
    try {
      const tasks = await gateway.list(sessionId);
      if (version === epoch.current)
        setState({
          sessionId,
          tasks: tasks.filter((task) => task.sessionId === sessionId),
          loading: false,
        });
    } catch (error) {
      if (version === epoch.current)
        setState((current) => ({
          ...current,
          sessionId,
          loading: false,
          error: error instanceof Error ? error.message : "服装任务加载失败。",
        }));
    }
  }, [gateway, sessionId]);
  useEffect(() => {
    const invalidate = () => {
      epoch.current++;
    };
    invalidate();
    void refresh();
    const timer = setInterval(() => {
      if (document.visibilityState !== "hidden") void refresh();
    }, 5000);
    return () => {
      invalidate();
      clearInterval(timer);
    };
  }, [refresh]);
  return {
    tasks: state.sessionId === sessionId ? state.tasks : [],
    loading: Boolean(
      gateway && sessionId && (state.sessionId !== sessionId || state.loading),
    ),
    error: state.sessionId === sessionId ? state.error : undefined,
    accept,
    refresh,
  };
}
