import {
  parseCommerceEdit,
  COMMERCE_SCENES,
  COMMERCE_PLATFORMS,
  type CommerceBrief,
  type CommerceGateway,
  type CommerceScene,
  type CommercePlan,
  type UploadReference,
  type CommerceTask,
  type TimelineItem,
} from "@zimage/domain";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ReactNode,
  type Ref,
} from "react";
import { Image as AntdImage } from "antd";
import Link from "next/link";
import { ArrowLeft, Layers3, Plus } from "lucide-react";
import { TemplatePreview } from "./TemplatePreview";
import { templateName } from "./commerce-ui";
import {
  CommerceTaskCard,
  type CommerceEditRequest,
  type CommerceConfirmationRequest,
} from "./CommerceTaskCard";
import type { CommerceWizardProps } from "./CommerceWizard";
const CommerceWizard = lazy(() => import("./CommerceWizard").then(module => ({ default: module.CommerceWizard })));
import { planOf, isExplicitImageRequest } from "./commerce-ui";
import { useCommerceTasks } from "./use-commerce-tasks";
import { isLocalCommerceDraft, type CommerceView } from "@/features/workspace/workspace-route";
import { loadCommerceDraft, clearCommerceDraft } from "./commerce-draft-storage";
import styles from "./commerce.module.css";

export interface CommerceWorkspaceHandle {
  open(scene: CommerceScene, prompt?: string): void;
  edit(message: string): boolean;
}
export interface CommerceLaunch {
  initialTemplateId?: string;
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
  ownerKey = 'local',
  ensureSession,
  onSavedSession,
  onDraftSessionsChange,
  requestedTaskId,
  requestedView,
  routeDriven = false,
  onViewChange,
  onExitDraft,
  items,
  timelineLoading = false,
  renderTimeline,
  onReferencesAdopt,
  onModeChange,
  onTaskChanged,
  ...wizardProps
}: {
  ref: Ref<CommerceWorkspaceHandle>;
  gateway?: CommerceGateway;
  sessionId?: string;
  launch?: CommerceLaunch;
  ownerKey?: string;
  ensureSession?: (title: string, requestId: string) => Promise<string>;
  onSavedSession?: (task: CommerceTask, sourceId: string) => void;
  onDraftSessionsChange?: (ids: string[]) => void;
  requestedTaskId?: string;
  requestedView?: CommerceView;
  routeDriven?: boolean;
  onViewChange?: (sessionId: string, taskId: string, view?: CommerceView) => void;
  onExitDraft?: () => void;
  onModeChange?: (sessionId: string | undefined, active: boolean) => void;
  onTaskChanged?: () => void | Promise<unknown>;
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
      isLocalCommerceDraft(sessionId) ? undefined : sessionId,
      Boolean(
        sessionId && Object.values(pendingSubmissions).includes(sessionId),
      ),
    );
  const acceptAndRefresh = useCallback((task: CommerceTask) => {
    accept(task);
    void Promise.resolve(onTaskChanged?.()).catch(() => undefined);
  }, [accept, onTaskChanged]);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [selectedBySession, setSelectedBySession] = useState<
    Record<string, string>
  >({});
  const [panels, setPanels] = useState<
    Record<string, "examples" | "plan" | "results">
  >({});
  const chooseTask = (id: string, targetSession = sessionId) => {
    if (targetSession) {
      setSelectedBySession(current => ({ ...current, [targetSession]: id }));
      onViewChange?.(targetSession, id);
    }
  };
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
  const [consumedLaunch, setConsumedLaunch] = useState<string>();
  const open = (scene: CommerceScene, prompt?: string) => {
    if (!sessionId) return;
    chooseTask("draft");
    const existing = drafts.find((draft) => draft.sessionId === sessionId);
    if (existing) {
      if (existing.scene === scene && prompt) {
        setDrafts((current) =>
          current.map((draft) =>
            draft.id === existing.id ? { ...draft, prompt } : draft,
          ),
        );
        setNote(
          "已把本次要求加入当前草稿，生成时将使用最新内容。",
        );
      } else
        setNote("已保留当前未保存方案。请先完成或取消它，再开始新的商品方案。");
      return;
    }
    setDrafts((current) => [
      ...current,
      { id: crypto.randomUUID(), sessionId, scene, prompt },
    ]);
    setNote(undefined);
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
      const task =
        tasks.find((item) => item.id === selectedBySession[sessionId ?? ""]) ??
        (tasks.length === 1 ? tasks[0] : undefined);
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
    let cancelled = false;
    // Restore tab-local drafts after the parent has resolved session ownership.
    void Promise.resolve().then(() => {
      if (cancelled || !sessionId) return;
      const restored = loadCommerceDraft(`${ownerKey}:${sessionId}`);
      const next = launch?.sessionId === sessionId ? launch : restored ? { sessionId, scene: restored.scene } : undefined;
      if (!next) return;
      setConsumedLaunch(sessionId);
      setDrafts(current => current.some(draft => draft.sessionId === sessionId) ? current : [...current, { ...next, id: crypto.randomUUID() }]);
    });
    return () => { cancelled = true; };
  }, [launch, sessionId, ownerKey]);
  useEffect(() => { onDraftSessionsChange?.(drafts.map(draft => draft.sessionId)); }, [drafts, onDraftSessionsChange]);
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
      chooseTask("draft");
      const message =
        "商品图与风格图合计最多 4 张，请先明确移除一张，再从当前会话任务中选择原任务并采用样图；不会自动替换。";
      setNote(message);
      throw new Error(message);
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
    chooseTask("draft");
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
  const hasCommerce = Boolean(
    tasks.length ||
    drafts.some((draft) => draft.sessionId === sessionId) ||
    (launch && launch.sessionId === sessionId && consumedLaunch !== launch.sessionId),
  );
  useEffect(() => {
    onModeChange?.(sessionId, hasCommerce);
  }, [hasCommerce, onModeChange, sessionId]);
  const saved = (draft: Draft, task: CommerceTask, generate = false) => {
    if (generate)
      setAutoStartTasks((current) => ({ ...current, [task.id]: true }));
    acceptAndRefresh(task);
    setSelectedBySession(current => ({ ...current, [task.sessionId]: task.id }));
    setPanels((current) => ({
      ...current,
      [task.id]: generate || task.runs.length ? "results" : "plan",
    }));
    setDrafts((current) => current.filter((item) => item.id !== draft.id));
    setNote(generate || task.runs.length ? undefined : "方案已保存，可随时生成。");
    onSavedSession?.(task, draft.sessionId);
  };
  const coordinatedLoading = timelineLoading || loading;
  const currentDraft = drafts.find((draft) => draft.sessionId === sessionId);
  const requestedTask = requestedTaskId ?? (routeDriven ? undefined : selectedBySession[sessionId ?? ""]);
  const selectedTask =
    tasks.find((task) => task.id === requestedTask) ?? (requestedTaskId && requestedTaskId !== "draft" ? undefined : tasks.at(-1));
  const showDraft = Boolean(
    currentDraft &&
    (!requestedTask ||
      requestedTask === "draft" ||
      !tasks.some((task) => task.id === requestedTask)),
  );
  const panelKey = showDraft ? currentDraft!.id : (selectedTask?.id ?? "");
  const panel =
    requestedView ?? ((!routeDriven || showDraft) ? panels[panelKey] : undefined) ??
    (showDraft ? "examples" : selectedTask?.runs.length ? "results" : "plan");
  const setPanel = (value: CommerceView) => {
    setPanels(current => ({ ...current, [panelKey]: value }));
    if (sessionId && selectedTask && !showDraft) onViewChange?.(sessionId, selectedTask.id, value);
  };
  const panelTabs = (
    <div
      className={styles.workbenchTabs}
      role="group"
      aria-label="电商工作台视图"
    >
      <button
        aria-pressed={panel === "examples"}
        onClick={() => setPanel("examples")}
      >
        示例
      </button>
      <button aria-pressed={panel === "plan"} onClick={() => setPanel("plan")}>
        方案
      </button>
      <button
        aria-pressed={panel === "results"}
        disabled={showDraft}
        onClick={() => setPanel("results")}
      >
        结果
      </button>
    </div>
  );
  return (
    <section className={hasCommerce ? styles.commerceRoot : undefined}>
      {requestedTaskId && requestedTaskId !== "draft" && !selectedTask && !loading && <p role="alert">任务不存在或不属于此会话，请选择其他任务。</p>}
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
      {hasCommerce && !coordinatedLoading && (
        <header className={styles.workbenchHeader}>
          <Link href="/create">
            <ArrowLeft size={15} aria-hidden />
            创作方式
          </Link>
          <span>
            <Layers3 size={17} aria-hidden />
            {(showDraft ? currentDraft?.scene : selectedTask?.scene) === "xhs-poster" ? "小红书海报工作台" : "电商工作台"}
          </span>
          {(tasks.length > 0 || currentDraft) && (
            <label className={styles.taskHistory}>
              当前会话
              <select
                aria-label="当前会话任务"
                value={showDraft ? "draft" : (selectedTask?.id ?? "")}
                onChange={(event) => chooseTask(event.target.value)}
              >
                {currentDraft && (
                  <option value="draft">新方案 · 尚未保存</option>
                )}
                {[...tasks].reverse().map((task) => (
                  <option value={task.id} key={task.id}>
                    {task.brief.name} · v{task.revision}
                    {task.archived ? " · 已归档" : ""}
                  </option>
                ))}
              </select>
            </label>
          )}
        </header>
      )}
      {/* Each task stays mounted across history switches so pending submissions and edits keep their identity. */}
      <div
        className={styles.savedWorkbench}
        hidden={
          !hasCommerce || showDraft || !selectedTask || coordinatedLoading
        }
      >
        <aside className={styles.savedBrief} aria-label={selectedTask?.brief.contentMode === "content" ? "已保存内容资料" : "已保存商品资料"}>
          {selectedTask && (
            <>
              <p className={styles.eyebrow}>{selectedTask.brief.contentMode === "content" ? "内容资料" : "商品资料"} · 已保存</p>
              <h2>{selectedTask.brief.name}</h2>
              <p className={styles.note}>
                {
                  COMMERCE_SCENES.find(
                    (scene) => scene.id === selectedTask.scene,
                  )?.name
                }{" "}
                · 方案 v{selectedTask.revision}
              </p>
              <dl>
                {selectedTask.brief.description && <div><dt>商品描述</dt><dd>{selectedTask.brief.description}</dd></div>}
                <div>
                  <dt>投放平台</dt>
                  <dd>
                    {
                      COMMERCE_PLATFORMS.find(
                        (platform) =>
                          platform.id === selectedTask.brief.platform,
                      )?.name
                    }
                  </dd>
                </div>
                <div>
                  <dt>创作用途</dt>
                  <dd>{selectedTask.brief.placement}</dd>
                </div>
                <div>
                  <dt>{selectedTask.brief.contentMode === "content" ? "内容事实" : "商品事实"}</dt>
                  <dd>{selectedTask.brief.facts || (selectedTask.brief.contentMode === "content" ? "未补充" : "以真实商品图为准")}</dd>
                </div>
                <div>
                  <dt>{selectedTask.brief.contentMode === "content" ? "内容要点" : "核心卖点"}</dt>
                  <dd>{selectedTask.brief.sellingPoints || "未补充"}</dd>
                </div>
                <div>
                  <dt>风格方向</dt>
                  <dd>{templateName(selectedTask.templateId)}</dd>
                </div>
                <div>
                  <dt>素材与数量</dt>
                  <dd>
                    {selectedTask.brief.productReferenceIds.length} 张{selectedTask.brief.contentMode === "content" ? "内容参考图" : "商品图"} ·{" "}
                    {selectedTask.brief.styleReferenceIds.length} 张风格图
                    <br />
                    {selectedTask.slots.length} 张方案图片
                  </dd>
                </div>
              </dl>
              <div className={styles.savedBriefActions}>
                <p className={styles.note}>
                  在右侧修改分图方案，或开始同场景的新创作。
                </p>
                <button onClick={() => open(selectedTask.scene)}>
                  <Plus size={15} aria-hidden />
                  新建{selectedTask.brief.contentMode === "content" ? "内容" : "商品"}方案
                </button>
              </div>
            </>
          )}
        </aside>
        <section className={styles.savedOutput} aria-label="电商方案与结果">
          {panelTabs}
          <div className={styles.outputScroll}>
            <div hidden={panel !== "examples"}>
              {selectedTask && (
                <>
                  <h2>效果示例</h2>
                  <p className={styles.note}>
                    当前模板的风格示例；未提供对应样图的角色显示布局说明。
                  </p>
                  <AntdImage.PreviewGroup>
                    <div className={styles.structureGrid}>
                      {selectedTask.slots.map((slot, index) => (
                        <div className={styles.structureCard} key={slot.id}>
                          <span className={styles.structureNumber}>
                            {String(index + 1).padStart(2, "0")}
                          </span>
                          <TemplatePreview templateId={selectedTask.templateId} role={slot.role} />
                          <strong>{slot.role}</strong>
                        </div>
                      ))}
                    </div>
                  </AntdImage.PreviewGroup>
                </>
              )}
            </div>
            {cachedTasks.map((task) => (
              <div
                key={task.id}
                hidden={
                  task.sessionId !== sessionId ||
                  task.id !== selectedTask?.id ||
                  panel === "examples" ||
                  coordinatedLoading
                }
              >
                {gateway && (
                  <AntdImage.PreviewGroup>
                    <CommerceTaskCard
                      task={task}
                      view={panel === "plan" ? "plan" : "results"}
                      autoStart={autoStartTasks[task.id]}
                      gateway={gateway}
                      capabilities={wizardProps.capabilities}
                      onTask={acceptAndRefresh}
                      onSubmitted={() =>
                        setPanels((current) => ({
                          ...current,
                          [task.id]: "results",
                        }))
                      }
                      editRequest={edits[task.id]}
                      confirmationRequest={confirmations[task.id]}
                      onSubmissionPendingChange={markSubmissionPending}
                      onPromote={promote}
                    />
                  </AntdImage.PreviewGroup>
                )}
              </div>
            ))}
          </div>
        </section>
      </div>
      {drafts.map((draft) => (
        <div
          className={styles.draftWorkbench}
          key={draft.id}
          hidden={
            draft.sessionId !== sessionId || !showDraft || coordinatedLoading
          }
        >
          <AntdImage.PreviewGroup>
            <Suspense fallback={<p role="status">正在打开商品编辑器…</p>}>
            <CommerceWizard
              {...wizardProps}
              {...draft}
              draftKey={`${ownerKey}:${draft.sessionId}`}
              ensureSession={ensureSession}
              embedded
              active={draft.sessionId === sessionId}
              promotedStyleIds={promotedStyles[draft.sessionId]}
              gateway={gateway}
              rightHeader={panelTabs}
              previewPanel={panel === "examples" ? "examples" : "plan"}
              onPreview={() =>
                setPanels((current) => ({ ...current, [draft.id]: "plan" }))
              }
              onSaved={(task, generate) => saved(draft, task, generate)}
              onClose={() => {
                clearCommerceDraft(`${ownerKey}:${draft.sessionId}`);
                setDrafts((current) =>
                  current.filter((item) => item.id !== draft.id),
                );
                if (selectedTask) chooseTask(selectedTask.id);
                else if (isLocalCommerceDraft(draft.sessionId)) onExitDraft?.();
              }}
            />
            </Suspense>
          </AntdImage.PreviewGroup>
        </div>
      ))}
      {hasCommerce && visible.length > 0 && !coordinatedLoading && (
        <details className={styles.relatedConversation}>
          <summary>查看此会话的聊天与其他图片（{visible.length}）</summary>
          {visible.map((item) => (
            <div key={item.id}>
              {renderTimeline([item], false, hasCommerce, false)}
            </div>
          ))}
        </details>
      )}
      {!hasCommerce &&
        !coordinatedLoading &&
        visible.map((item) => (
          <div key={item.id}>{renderTimeline([item], false, false, false)}</div>
        ))}
      {renderTimeline(
        [],
        true,
        hasCommerce || Boolean(visible.length),
        coordinatedLoading,
      )}
    </section>
  );
}
