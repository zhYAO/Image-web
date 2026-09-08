import {
  parseCommerceEdit,
  type CommerceBrief,
  type CommerceGateway,
  type CommerceScene,
  type CommercePlan,
  type UploadReference,
  type CommerceTask,
  type TimelineItem,
} from "@zimage/domain";
import {
  Fragment,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ReactNode,
  type Ref,
} from "react";
import {
  CommerceTaskCard,
  type CommerceEditRequest,
  type CommerceConfirmationRequest,
} from "./CommerceTaskCard";
import { CommerceWizard, type CommerceWizardProps } from "./CommerceWizard";
import { planOf, isExplicitImageRequest } from "./commerce-ui";
import { useCommerceTasks } from "./use-commerce-tasks";
import styles from "./commerce.module.css";

export interface CommerceWorkspaceHandle {
  open(scene: CommerceScene, prompt?: string): void;
  edit(message: string): boolean;
}
export interface CommerceLaunch {
  prompt?: string;
  scene: CommerceScene;
  platform?: CommerceBrief["platform"];
  sessionId: string;
}
type Draft = CommerceLaunch & {
  id: string;
  prompt?: string;
  seedPlan?: CommercePlan;
};

export function CommerceWorkspace({
  ref,
  gateway,
  sessionId,
  launch,
  items,
  timelineLoading = false,
  renderTimeline,
  onReferencesAdopt,
  onModeChange,
  ...wizardProps
}: {
  ref: Ref<CommerceWorkspaceHandle>;
  gateway?: CommerceGateway;
  sessionId?: string;
  launch?: CommerceLaunch;
  onModeChange?: (sessionId: string | undefined, active: boolean) => void;
  onReferencesAdopt: (
    references: UploadReference[],
    sessionId: string,
  ) => boolean;
  items: TimelineItem[];
  timelineLoading?: boolean;
  renderTimeline: (
    items: TimelineItem[],
    tail: boolean,
    hasCommerce: boolean,
    loading: boolean,
  ) => ReactNode;
} & Pick<
  CommerceWizardProps,
  | "capabilities"
  | "references"
  | "settings"
  | "onReferenceAdd"
  | "onReferenceRemove"
  | "onReferenceUploaded"
>) {
  const [pendingSubmissions, setPendingSubmissions] = useState<
    Record<string, string | undefined>
  >({});
  const markSubmissionPending = useCallback(
    (taskId: string, pending: boolean, taskSessionId: string) =>
      setPendingSubmissions((current) => {
        const next = pending ? taskSessionId : undefined;
        return current[taskId] === next
          ? current
          : { ...current, [taskId]: next };
      }),
    [],
  );
  const { tasks, cachedTasks, accept, error, loading, refresh } =
    useCommerceTasks(
      gateway,
      sessionId,
      Boolean(
        sessionId && Object.values(pendingSubmissions).includes(sessionId),
      ),
    );
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [note, setNote] = useState<string>();
  const [autoStartTasks, setAutoStartTasks] = useState<Record<string, boolean>>(
    {},
  );
  const [confirmations, setConfirmations] = useState<
    Record<string, CommerceConfirmationRequest>
  >({});
  const [edits, setEdits] = useState<Record<string, CommerceEditRequest>>({});
  const [promotedStyles, setPromotedStyles] = useState<
    Record<string, string[]>
  >({});
  const promotionKeys = useRef(new Map<string, string>());
  const launched = useRef<string | undefined>(undefined);
  const [consumedLaunch, setConsumedLaunch] = useState<string>();
  const open = (scene: CommerceScene, prompt?: string) => {
    if (!sessionId) return;
    const existing = drafts.find((draft) => draft.sessionId === sessionId);
    if (existing) {
      if (existing.scene === scene && prompt) {
        setDrafts((current) =>
          current.map((draft) =>
            draft.id === existing.id ? { ...draft, prompt } : draft,
          ),
        );
        setNote(
          "已把本次要求加入当前未保存方案；请检查分图内容，再保存并确认。",
        );
      } else
        setNote("已保留当前未保存方案。请先完成或取消它，再开始新的商品方案。");
      return;
    }
    setDrafts((current) => [
      ...current,
      { id: crypto.randomUUID(), sessionId, scene, prompt },
    ]);
    setNote("已打开新方案；发送只用于规划，保存并确认后才会生成。");
  };
  useImperativeHandle(ref, () => ({
    open,
    edit(message) {
      // Ordinary sessions must not be intercepted by commerce edit grammar.
      if (
        !tasks.length &&
        !drafts.some((draft) => draft.sessionId === sessionId)
      )
        return false;
      const task = tasks.length === 1 ? tasks[0] : undefined;
      if (
        isExplicitImageRequest(message) &&
        /这(?:一)?套|当前(?:方案|任务|套图)|剩余(?:的)?(?:图|图片)|这些图/.test(
          message,
        )
      ) {
        if (!task)
          setNote(
            drafts.some((draft) => draft.sessionId === sessionId)
              ? "请先完成当前草案并保存分图方案，再确认生成。"
              : "请先选择要生成的任务，明确本次方案和图片。",
          );
        else {
          setConfirmations((current) => ({
            ...current,
            [task.id]: {
              id: crypto.randomUUID(),
              selection: /剩余/.test(message) ? "remaining" : "all",
            },
          }));
          setNote(
            `已定位「${task.brief.name}」方案 v${task.revision}，请在任务卡核对图片和额度后确认生成。`,
          );
          document
            .getElementById(`commerce-task-${task.id}`)
            ?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
        }
        return true;
      }
      const parsed = parseCommerceEdit(message, task?.slots.length ?? 8);
      if (!parsed) return false;
      if (!task) {
        setNote(
          "请先点击要修改任务的“在对话中修改此任务”，明确本次修改属于哪一套图片。",
        );
        return true;
      }
      setEdits((current) => ({
        ...current,
        [task.id]: { id: crypto.randomUUID(), ...parsed },
      }));
      setNote(
        `正在修改「${task.brief.name}」方案 v${task.revision}；保存后需再次确认。`,
      );
      return true;
    },
  }));
  useEffect(() => {
    if (!launch || launched.current === launch.sessionId) return;
    launched.current = launch.sessionId;
    setConsumedLaunch(launch.sessionId);
    setDrafts((current) => [
      ...current,
      { ...launch, id: crypto.randomUUID() },
    ]);
  }, [launch]);
  const promote = async (task: CommerceTask, generationId: string) => {
    if (!gateway || !sessionId || task.sessionId !== sessionId) return;
    const currentDraft = drafts.find((draft) => draft.sessionId === sessionId);
    const taskIds = [
      ...task.brief.productReferenceIds,
      ...task.brief.styleReferenceIds,
    ];
    if (
      !currentDraft &&
      wizardProps.references.some(
        (reference) => !reference.id || !taskIds.includes(reference.id),
      )
    ) {
      throw new Error(
        "输入区还有其他素材。请先完成当前创作或明确移除这些素材，再采用此任务的样图。",
      );
    }
    const base: UploadReference[] = currentDraft
      ? wizardProps.references
      : taskIds.map(
          (id, index) =>
            wizardProps.references.find((reference) => reference.id === id) ?? {
              id,
              name: `已保存素材 ${index + 1}`,
              mimeType: "",
              size: 0,
              status: "ready",
            },
        );
    if (base.length >= 4) {
      // Expose the existing references so removal is an actionable user choice.
      if (!currentDraft && onReferencesAdopt(base, sessionId))
        setDrafts((current) => [
          ...current,
          {
            id: crypto.randomUUID(),
            scene: task.scene,
            sessionId,
            seedPlan: planOf(task),
          },
        ]);
      throw new Error(
        "商品图与风格图合计最多 4 张，请先明确移除一张，再采用样图；不会自动替换。",
      );
    }
    const key = `${task.id}:${generationId}`;
    let requestId = promotionKeys.current.get(key);
    if (!requestId) {
      requestId = crypto.randomUUID();
      promotionKeys.current.set(key, requestId);
    }
    const reference = await gateway.promote(task.id, {
      requestId,
      generationId,
    });
    const next = base.some((item) => item.id === reference.id)
      ? base
      : [...base, { ...reference, status: "ready" as const }];
    if (!onReferencesAdopt(next, sessionId))
      throw new Error(
        "当前会话或素材已变化，请返回原会话并确保合计不超过 4 张后重试。",
      );
    setPromotedStyles((current) => ({
      ...current,
      [sessionId]: [...(current[sessionId] ?? []), reference.id],
    }));
    if (!currentDraft)
      setDrafts((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          scene: task.scene,
          sessionId,
          seedPlan: planOf(task),
        },
      ]);
    setNote(
      "样图已加入当前草案并标为风格参考。请检查素材和分图方案，保存并确认后才生成；原任务已保留。",
    );
  };
  const underlying = new Set(
    tasks.flatMap((task) =>
      task.runs.flatMap((run) => run.items.map((item) => item.batchId)),
    ),
  );
  const visible = items.filter(
    (item) => item.type !== "generation" || !underlying.has(item.batch.id),
  );
  const entries = [
    ...visible.map((item) => ({ date: item.createdAt, id: item.id, item })),
    ...cachedTasks.map((task) => ({ date: task.createdAt, id: task.id, task })),
  ].sort((a, b) => a.date.localeCompare(b.date));
  const hasCommerce = Boolean(
    tasks.length ||
    drafts.some((draft) => draft.sessionId === sessionId) ||
    (launch?.sessionId === sessionId && consumedLaunch !== launch?.sessionId),
  );
  useEffect(() => {
    onModeChange?.(sessionId, hasCommerce);
  }, [hasCommerce, onModeChange, sessionId]);
  const saved = (draft: Draft, task: CommerceTask, generate = false) => {
    if (generate)
      setAutoStartTasks((current) => ({ ...current, [task.id]: true }));
    accept(task);
    setDrafts((current) => current.filter((item) => item.id !== draft.id));
    setNote(generate ? undefined : "方案已保存，可随时生成。");
  };
  const coordinatedLoading = timelineLoading || loading;
  return (
    <>
      {error && (
        <p className={styles.notice} role="alert">
          电商任务加载失败：{error}
          {!hasCommerce && " 普通对话和单张生图仍可使用。"}
          <button onClick={() => void refresh().catch(() => undefined)}>
            重试任务载入
          </button>
        </p>
      )}
      {note && hasCommerce && (
        <p className={styles.notice} role="status">
          {note}
        </p>
      )}
      {/* Wait for commerce facts before exposing child batches as standalone generations. */}
      {entries.map((entry) => (
        <Fragment key={entry.id}>
          {"task" in entry && gateway ? (
            <div
              hidden={entry.task.sessionId !== sessionId || coordinatedLoading}
            >
              <CommerceTaskCard
                key={entry.task.id}
                task={entry.task}
                autoStart={autoStartTasks[entry.task.id]}
                gateway={gateway}
                capabilities={wizardProps.capabilities}
                onTask={accept}
                editRequest={edits[entry.task.id]}
                confirmationRequest={confirmations[entry.task.id]}
                onSubmissionPendingChange={markSubmissionPending}
                onPromote={promote}
              />
            </div>
          ) : "item" in entry && !coordinatedLoading ? (
            renderTimeline([entry.item], false, hasCommerce, false)
          ) : null}
        </Fragment>
      ))}
      {!(
        hasCommerce &&
        !visible.length &&
        (drafts.some((draft) => draft.sessionId === sessionId) ||
          launch?.sessionId === sessionId)
      ) &&
        renderTimeline(
          [],
          true,
          hasCommerce || Boolean(visible.length),
          coordinatedLoading,
        )}
      {drafts.map((draft) => (
        <div key={draft.id} hidden={draft.sessionId !== sessionId}>
          <CommerceWizard
            {...wizardProps}
            {...draft}
            active={draft.sessionId === sessionId}
            promotedStyleIds={promotedStyles[draft.sessionId]}
            gateway={gateway}
            onSaved={(task, generate) => saved(draft, task, generate)}
            onClose={() =>
              setDrafts((current) =>
                current.filter((item) => item.id !== draft.id),
              )
            }
          />
        </div>
      ))}
    </>
  );
}
