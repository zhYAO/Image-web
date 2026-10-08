import { useCallback, useEffect, useRef, useState } from "react";
import type { ApparelTask, ApparelGateway } from "@zimage/domain";
import { nextPollingDelay } from '@/features/workspace/bounded-polling';
export function useApparelTasks(
  gateway: ApparelGateway | undefined,
  sessionId: string | undefined,
  pollTarget: string | false = 'all',
) {
  const [state, setState] = useState<{
    sessionId?: string;
    tasks: ApparelTask[];
    loading: boolean;
    error?: string;
  }>({ tasks: [], loading: Boolean(gateway && sessionId) });
  const epoch = useRef(0);
  const inFlight = useRef(new Map<string, Promise<void>>());
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
    const pending = inFlight.current.get(sessionId);
    if (pending) return pending;
    const request = (async () => {
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
    })();
    inFlight.current.set(sessionId, request);
    try { await request; } finally { if (inFlight.current.get(sessionId) === request) inFlight.current.delete(sessionId); }
  }, [gateway, sessionId]);
  const sessionTasks = state.sessionId === sessionId ? state.tasks : [];
  const polledTasks = pollTarget === false ? [] : pollTarget === 'all' ? sessionTasks :
    pollTarget === 'latest' ? sessionTasks.slice(-1) : sessionTasks.filter(task => task.id === pollTarget);
  const activeSinceKey = polledTasks.flatMap(task =>
    task.runs.filter(run => run.status === 'processing').map(run => run.createdAt)).join('|');
  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(() => {
    let stopped = false;
    let timer: number | undefined;
    const schedule = () => {
      const delays = activeSinceKey.split('|').filter(Boolean).map(createdAt => nextPollingDelay(createdAt, 'commerce'))
        .filter((value): value is number => value !== null);
      if (!delays.length || stopped) return;
      timer = window.setTimeout(async () => {
        if (activeSinceKey.split('|').filter(Boolean).some(createdAt => nextPollingDelay(createdAt, 'commerce') !== null)
          && document.visibilityState !== 'hidden') await refresh();
        schedule();
      }, Math.min(...delays));
    };
    schedule();
    return () => {
      stopped = true;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [refresh, activeSinceKey]);
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
