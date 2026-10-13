'use client';

import {
  CHAT_PROVIDER_MODELS,
  COMMERCE_SCENES,
  imageCreditItem,
  formatCredits,
  type CreditConfirmation,
  templatesForScene,
  hasTextOnlyImageIntent,
  MAX_UPLOAD_BYTES,
  sanitizeError,
  type ChatRequest,
  type CommerceScene,
  type MessageTimelineItem,
  type GenerationBatch,
  type ImageRequest,
  type ProviderCapability,
  type ProviderHealth,
  type Quota,
  type RecreateScope,
  type SafeError,
  type Session,
  type TimelineItem,
  type UploadReference,
  type WorkspaceGateway,
} from '@zimage/domain';
import { Alert, Button, Drawer, Select, Space } from 'antd';
import PreviewGroup from 'antd/es/image/PreviewGroup';
import { Archive, ArrowDown, Menu } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { CommerceWorkspace, type CommerceWorkspaceHandle, type CommerceLaunch } from '@/features/commerce/CommerceWorkspace';
import { isCommerceDiscussion, resolveCommerceLaunch } from '@/features/commerce/commerce-ui';

import { useCredits, CreditBalance } from '@/features/credits/CreditsProvider';
import { getWorkspaceGateway } from '@/gateways';
import { normalizeReferenceUploadFile } from '@/gateways/reference-upload-file';
import { MockWorkspaceGateway } from '@/gateways/mock-workspace-gateway';
import { zhCN } from '@/i18n';
import { NavGlassFilter } from './NavGlassFilter';
import { useWorkspaceStore, snapshotComposer, type ComposerState } from '@/store/workspace-store';
import { sessionHref, isLocalCommerceDraft, type WorkspaceRoute } from './workspace-route';
import { mergeSessionActivity } from './session-category';
import { lastComposerSession } from '@/store/composer-storage';

import { findModelCapability, normalizeGenerationSelection } from './GenerationConfig';
import { SessionSidebar } from './SessionSidebar';
import { downloadImages } from './download-images';
import { chatRecoveryActions, reconcileChatTimeline, type FailedChatAttempt } from './chat-recovery';
import { UnifiedComposer } from './UnifiedComposer';
import { useSmartAutoScroll } from './use-smart-auto-scroll';
import { WorkspaceTimeline, type OptimisticImageTurnView } from './WorkspaceTimeline';
import { nextPollingDelay } from './bounded-polling';
import styles from './workspace.module.css';
import { CommerceCatalogue } from '@/features/commerce/CommerceCatalogue';
import { WorkspaceFrame } from './WorkspaceFrame';
import Link from 'next/link';

interface UnifiedWorkspaceProps {
  gateway?: WorkspaceGateway;
  route?: WorkspaceRoute;
  ownerKey?: string;
  onNavigate?: (url: string, replace?: boolean) => void;
}

interface ReferencePreparationScope {
  ownerKey: string;
  source?: string;
  route?: WorkspaceRoute;
}

interface OptimisticImageTurn extends OptimisticImageTurnView {
  previewUrls: string[];
  request: ImageRequest;
}

interface SessionRuntime {
  awaitingFirstDelta: boolean;
  chatBusy: boolean;
  isChatStreaming: boolean;
  loadError?: SafeError;
  loadStatus: 'error' | 'idle' | 'loading' | 'ready';
  optimisticImages: OptimisticImageTurn[];
  streamingText: string;
  timeline: TimelineItem[];
  retainedItems: TimelineItem[];
  chatFailures: FailedChatAttempt[];
}

const MAX_REFERENCES = 4;
const CHAT_STREAM_TIMEOUT_MS = 75_000;
const ALLOWED_REFERENCE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

const createRuntime = (loadStatus: SessionRuntime['loadStatus'] = 'idle'): SessionRuntime => ({
  awaitingFirstDelta: false,
  chatBusy: false,
  isChatStreaming: false,
  loadStatus,
  optimisticImages: [],
  streamingText: '',
  timeline: [],
  retainedItems: [],
  chatFailures: [],
});

const nextSequence = (items: TimelineItem[]) => (
  items.reduce((maximum, item) => Math.max(maximum, item.sequence), 0) + 1
);

export function UnifiedWorkspace({ gateway: providedGateway, route, onNavigate, ownerKey = "local" }: UnifiedWorkspaceProps) {
  const credits = useCredits();
  const routeRef = useRef(route);
  useLayoutEffect(() => { routeRef.current = route; }, [route]);
  const [routeError, setRouteError] = useState<string>();
  const [commerceDraftIds, setCommerceDraftIds] = useState<ReadonlySet<string>>(new Set());
  const onDraftSessionsChange = useCallback((ids: string[]) => setCommerceDraftIds(new Set(ids)), []);
  const gateway = useMemo(() => providedGateway ?? getWorkspaceGateway(), [providedGateway]);
  const {
    activateComposer,
    forgetComposer,
    aspectRatio, setAspectRatio,
    resolution, setResolution,
    setCount,
    selectedProvider, setSelectedProvider,
    selectedModelId, setSelectedModelId,
    selectedChatModel, setSelectedChatModel,
    references, setReferences, restoringAttachments,
    activePopover,
    configDrawerOpen,
    draft,
    explicitImageToolEnabled,
    scenario,
    sidebarCollapsed,
    sessionDrawerOpen,
    setActivePopover,
    setConfigDrawerOpen,
    setDraft,
    setExplicitImageToolEnabled,
    setScenario,
    setSessionDrawerOpen,
    setSidebarCollapsed,
  } = useWorkspaceStore();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [initializing, setInitializing] = useState(true);
  const [initializationError, setInitializationError] = useState<string>();
  const [legacyCommerceEntry] = useState(() => !route && typeof window !== 'undefined' && Boolean(resolveCommerceLaunch(window.location.search).scene));
  const legacyCommercePending = legacyCommerceEntry && (initializing || Boolean(initializationError));
  const [initializationAttempt, setInitializationAttempt] = useState(0);
  const [quotaError, setQuotaError] = useState<string>();
  const [modelsError, setModelsError] = useState<string>();
  const [modelsLoading, setModelsLoading] = useState(true);
  const [quotaAttempt, setQuotaAttempt] = useState(0);
  const [modelsAttempt, setModelsAttempt] = useState(0);
  const [deletingSessionId, setDeletingSessionId] = useState<string>();
  const deletionLock = useRef(false);
  const firstSubmissionLock = useRef(false);
  const selectionVersion = useRef(0);
  useLayoutEffect(() => { selectionVersion.current++; }, [ownerKey]);
  const [referencePreparation, setReferencePreparation] = useState<{
    version: number; scope: ReferencePreparationScope; count: number;
  }>();
  const [pendingFirstMessage, setPendingFirstMessage] = useState<MessageTimelineItem>();
  const sessionsRef = useRef<Session[]>([]);
  const [activeSessionId, setActiveSessionState] = useState<string>();
  const referenceScope = useMemo(() => ({ ownerKey, source: activeSessionId, route }), [ownerKey, activeSessionId, route]);
  const preparingReferences = referencePreparation?.scope === referenceScope ? referencePreparation.count : 0;
  const composerDefaults = useRef<Partial<ComposerState>>({});
  const setActiveSessionId = useCallback((id?: string, inheritCurrent = false) => {
    selectionVersion.current++;
    setReferencePreparation(undefined);
    activateComposer(id, composerDefaults.current, inheritCurrent);
    setActiveSessionState(id);
  }, [activateComposer]);
  const [runtimes, setRuntimes] = useState<Record<string, SessionRuntime>>({});
  const runtimesRef = useRef<Record<string, SessionRuntime>>({});
  const timelineRequestVersions = useRef(new Map<string, number>());
  const chatControllers = useRef(new Map<string, AbortController>());
  const [quota, setQuota] = useState<Quota>();
  const quotaRequestVersion = useRef(0);
  const refreshQuota = useCallback(async () => {
    const version = ++quotaRequestVersion.current;
    const next = await gateway.getQuota();
    if (version === quotaRequestVersion.current) setQuota(next);
  }, [gateway]);
  const [capabilities, setCapabilities] = useState<ProviderCapability[]>([]);
  const [health, setHealth] = useState<ProviderHealth[]>([]);
  const commerceCapabilities = useMemo(() => {
    const available = capabilities.filter(capability => health.find(item => item.provider === capability.provider)?.status !== 'unavailable');
    return available.length ? available : capabilities;
  }, [capabilities, health]);
  const [feedback, setFeedback] = useState<{ error?: SafeError; message: string; retrySessionId?: string }>();
  const localPreviewUrls = useRef(new Set<string>());
  const downloadingBatches = useRef(new Set<string>());
  const commerceRef = useRef<CommerceWorkspaceHandle>(null);
  const [commerceLaunch, setCommerceLaunch] = useState<CommerceLaunch>();
  const [commerceMode, setCommerceMode] = useState<{ sessionId?: string; active: boolean; scene?: CommerceScene }>();
  const commerceActive = commerceMode?.sessionId === activeSessionId && Boolean(commerceMode?.active);
  const commerceShell = commerceActive || route?.kind === 'commerce';
  const catalogueActive = route?.kind === 'catalogue';
  const maxActiveReferences = commerceActive || route?.kind === 'commerce' ? 26 : MAX_REFERENCES;
  const onCommerceModeChange = useCallback((sessionId: string | undefined, active: boolean, scene?: CommerceScene) => {
    setCommerceMode((current) => current?.sessionId === sessionId && current?.active === active && current?.scene === scene ? current : { sessionId, active, scene });
  }, []);

  const sessionListVersion = useRef(0);
  const updateSessions = useCallback((next: Session[]) => {
    sessionListVersion.current += 1;
    const merged = mergeSessionActivity(next, sessionsRef.current);
    sessionsRef.current = merged;
    setSessions(merged);
  }, []);

  const updateRuntime = useCallback((sessionId: string, updater: (runtime: SessionRuntime) => SessionRuntime) => {
    setRuntimes((current) => {
      const next = { ...current, [sessionId]: updater(current[sessionId] ?? createRuntime()) };
      runtimesRef.current = next;
      return next;
    });
  }, []);

  const removeRuntime = useCallback((sessionId: string) => {
    setRuntimes((current) => {
      const next = { ...current };
      delete next[sessionId];
      runtimesRef.current = next;
      return next;
    });
  }, []);

  const refreshSessions = useCallback(async () => {
    const version = ++sessionListVersion.current;
    const next = await gateway.listSessions();
    if (version !== sessionListVersion.current) return sessionsRef.current;
    updateSessions(next);
    return next;
  }, [gateway, updateSessions]);

  const refreshTimeline = useCallback(async (sessionId: string, showLoading = false) => {
    const version = (timelineRequestVersions.current.get(sessionId) ?? 0) + 1;
    timelineRequestVersions.current.set(sessionId, version);
    if (showLoading) {
      updateRuntime(sessionId, (runtime) => ({ ...runtime, loadError: undefined, loadStatus: 'loading' }));
    }
    try {
      const timeline = await gateway.getTimeline(sessionId);
      if (timelineRequestVersions.current.get(sessionId) !== version) return;
      updateRuntime(sessionId, (runtime) => ({ ...runtime, loadError: undefined, loadStatus: 'ready', ...reconcileChatTimeline(timeline, runtime.retainedItems, runtime.chatFailures) }));
    } catch (error: unknown) {
      if (timelineRequestVersions.current.get(sessionId) !== version) return;
      const safe = sanitizeError(error);
      if (safe.code === 'SESSION_NOT_FOUND') {
        updateRuntime(sessionId, (runtime) => ({ ...runtime, loadStatus: 'ready', timeline: [] }));
        return;
      }
      updateRuntime(sessionId, (runtime) => ({ ...runtime, loadError: safe, loadStatus: 'error' }));
    }
  }, [gateway, updateRuntime]);

  useEffect(() => {
    let cancelled = false;
    const initialize = async () => {
      const version = ++sessionListVersion.current;
      const nextSessions = await gateway.listSessions();
      if (cancelled || version !== sessionListVersion.current) return;
      updateSessions(nextSessions);
      const launchUrl = new URL(window.location.href);
      const launchCommerce = resolveCommerceLaunch(launchUrl.search);
      const launchScene = launchCommerce.scene;
      let initialId = lastComposerSession(nextSessions.map(session => session.id)) ?? nextSessions[0]?.id;
      if (launchScene && !routeRef.current) {
        const session = await gateway.createSession();
        if (cancelled) return;
        updateSessions([session, ...nextSessions]);
        initialId = session.id;
      }
      if (routeRef.current) initialId = undefined;
      if (!routeRef.current) setActiveSessionId(initialId);
      if (!routeRef.current && launchScene && initialId) {
        setCommerceLaunch({ scene: launchScene, platform: launchCommerce.platform, initialTemplateId: templatesForScene(launchScene).find(template => template.id === launchUrl.searchParams.get('template'))?.id, sessionId: initialId });
      }
      // Legacy Skill links must never implicitly open a commerce workflow.
      if (!routeRef.current && launchUrl.searchParams.has('skill')) {
        launchUrl.searchParams.delete('skill');
        launchUrl.searchParams.delete('new');
        window.history.replaceState(window.history.state, '', `${launchUrl.pathname}${launchUrl.search}${launchUrl.hash}`);
      }
      if (launchScene && !routeRef.current) {
        launchUrl.searchParams.delete('scene');
        launchUrl.searchParams.delete('platform');
        launchUrl.searchParams.delete('template');
        window.history.replaceState(window.history.state, '', `${launchUrl.pathname}${launchUrl.search}${launchUrl.hash}`);
      }
      if (initialId) await refreshTimeline(initialId, true);
      if (!cancelled && gateway instanceof MockWorkspaceGateway) {
        const recoveryNotice = gateway.getRecoveryNotice();
        if (recoveryNotice) setFeedback({ message: recoveryNotice });
      }
    };
    void initialize().catch((error: unknown) => {
      if (!cancelled) {
        const safe = sanitizeError(error);
        if (safe.code === 'UNAUTHORIZED') return;
        setInitializationError(safe.message);
        setFeedback({ error: safe, message: safe.message });
      }
    }).finally(() => {
      if (!cancelled) setInitializing(false);
    });
    return () => {
      cancelled = true;
    };
  }, [gateway, initializationAttempt, refreshTimeline, updateSessions, setActiveSessionId, setAspectRatio, setCount, setResolution, setSelectedProvider, setSelectedModelId]);

  useEffect(() => {
    let cancelled = false;
    const version = ++quotaRequestVersion.current;
    void gateway.getQuota().then(next => {
      if (!cancelled && version === quotaRequestVersion.current) { setQuota(next); setQuotaError(undefined); }
    }).catch(error => { if (!cancelled) setQuotaError(sanitizeError(error).message); });
    return () => { cancelled = true; };
  }, [gateway, quotaAttempt]);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([gateway.getProviderCapabilities(), gateway.getProviderHealth()]).then(([nextCapabilities, nextHealth]) => {
      if (cancelled) return;
      setCapabilities(nextCapabilities);
      setHealth(nextHealth);
      setModelsError(undefined);
      const available = nextCapabilities.filter(capability => nextHealth.find(item => item.provider === capability.provider)?.status !== 'unavailable');
      const defaults = normalizeGenerationSelection(available.length ? available : nextCapabilities, { aspectRatio: '1:1', count: 1, resolution: '2K' });
      composerDefaults.current = { aspectRatio: defaults.aspectRatio, count: defaults.count, resolution: defaults.resolution,
        selectedProvider: defaults.provider, selectedModelId: defaults.model };
      // Only fill missing defaults. A late response must not overwrite a restored draft or user choice.
      const current = useWorkspaceStore.getState();
      if (!current.selectedProvider || !current.selectedModelId) {
        const initial = normalizeGenerationSelection(available.length ? available : nextCapabilities, {
          aspectRatio: current.aspectRatio, count: 1, resolution: current.resolution,
        });
        setSelectedProvider(initial.provider);
        setSelectedModelId(initial.model);
        setAspectRatio(initial.aspectRatio);
        setCount(initial.count);
        setResolution(initial.resolution);
      }
    }).catch(error => { if (!cancelled) setModelsError(sanitizeError(error).message); })
      .finally(() => { if (!cancelled) setModelsLoading(false); });
    return () => { cancelled = true; };
  }, [gateway, modelsAttempt, setSelectedProvider, setSelectedModelId, setAspectRatio, setCount, setResolution]);

  const appliedRoute = useRef<string | undefined>(undefined);
  const routeScope = route?.kind === 'session' ? `session:${route.sessionId}` : route?.kind === 'commerce' ? `commerce:${ownerKey}:${route.scene}` : route?.kind;
  useEffect(() => {
    if (route?.kind === 'outside') { appliedRoute.current = undefined; return; }
    if (!route || (initializing && route.kind === 'session') || appliedRoute.current === routeScope) return;
    let cancelled = false;
    void Promise.resolve().then(() => {
    if (cancelled) return;
    appliedRoute.current = routeScope;
    setRouteError(undefined);
    if (route.kind === 'catalogue') {
      setActivePopover(undefined);
      setConfigDrawerOpen(false);
      return;
    }
    if (route.kind === 'invalid') {
      setRouteError('页面不存在，请选择创作方式或历史会话。');
      return;
    }
    if (route.kind === 'session') {
      if (!sessionsRef.current.some(session => session.id === route.sessionId)) {
        setRouteError('会话不存在、已删除或无权访问。');
        setActiveSessionId(undefined);
        return;
      }
      setActiveSessionId(route.sessionId);
      setCommerceLaunch(undefined);
      void refreshTimeline(route.sessionId, true);
    } else if (route.kind === 'commerce') {
      const id = `commerce-draft:${ownerKey}:${route.scene}`;
      setActiveSessionId(id);
      updateRuntime(id, () => createRuntime('ready'));
      setCommerceLaunch({ sessionId: id, scene: route.scene, platform: route.platform,
        initialTemplateId: templatesForScene(route.scene).find(item => item.id === route.template)?.id });
    } else {
      setActiveSessionId(undefined);
      setCommerceLaunch(undefined);
    }
    });
    return () => { cancelled = true; };
  }, [route, routeScope, initializing, ownerKey, setActiveSessionId, setActivePopover, setConfigDrawerOpen, refreshTimeline, updateRuntime]);

  const ensureCommerceSession = async (title: string, requestId: string) => {
    const session = await gateway.createSession(title.slice(0, 100), requestId);
    updateSessions([{ ...session, activityTypes: ['commerce'] }, ...sessionsRef.current.filter(item => item.id !== session.id)]);
    return session.id;
  };
  const commerceSaved = (task: import('@zimage/domain').CreativeCommerceTask, sourceId: string) => {
    const current = useWorkspaceStore.getState();
    const stillHere = current.activeComposerSessionId === sourceId && routeRef.current?.kind !== 'outside' && routeRef.current?.kind !== 'catalogue';
    if (isLocalCommerceDraft(sourceId)) current.transferComposer(sourceId, task.sessionId);
    updateSessions([{ ...sessionsRef.current.find(item => item.id === task.sessionId)!, id: task.sessionId,
      title: sessionsRef.current.find(item => item.id === task.sessionId)?.title ?? ('engine' in task ? task.plan.brief.name : task.brief.name),
      status: 'active', createdAt: task.createdAt, updatedAt: task.updatedAt, activityTypes: ['commerce'] },
      ...sessionsRef.current.filter(item => item.id !== task.sessionId)]);
    if (stillHere) {
      setActiveSessionId(task.sessionId);
      onNavigate?.(sessionHref(task.sessionId, task.id, task.runs.length ? 'results' : 'plan'), true);
    }
  };

  useEffect(() => {
    for (const reference of references) {
      if (reference.previewUrl?.startsWith('blob:')) localPreviewUrls.current.add(reference.previewUrl);
    }
  }, [references]);

  useEffect(
    () => () => {
      selectionVersion.current++;
      for (const previewUrl of localPreviewUrls.current) URL.revokeObjectURL(previewUrl);
      localPreviewUrls.current.clear();
      for (const controller of chatControllers.current.values()) controller.abort();
      chatControllers.current.clear();
    },
    [],
  );

  const pendingBatchEntries = useMemo(() => Object.entries(runtimes).flatMap(([sessionId, runtime]) => (
    commerceActive || sessionId !== activeSessionId ? [] :
    runtime.timeline.flatMap((item) => (
      item.type === 'generation' && (item.batch.status === 'pending' || item.batch.status === 'processing')
        && item.batch.assets.some((asset) =>
          (asset.status === 'pending' || asset.status === 'processing') && asset.error?.code !== 'CONFLICT'
        )
        ? [{ batchId: item.batch.id, sessionId, createdAt: item.batch.createdAt }]
        : []
    ))
  )), [runtimes, activeSessionId, commerceActive]);
  const pendingBatchKey = pendingBatchEntries.map((entry) => `${entry.sessionId}:${entry.batchId}:${entry.createdAt}`).join('|');
  const batchPollInFlight = useRef(new Set<string>());
  const batchLastPolled = useRef(new Map<string, number>());

  useEffect(() => {
    if (!pendingBatchKey) return;
    let stopped = false;
    let timer: number | undefined;
    const poll = async () => {
      if (document.visibilityState === 'hidden') return;
      await Promise.all(pendingBatchEntries.map(async ({ batchId, sessionId, createdAt }) => {
        const delay = gateway instanceof MockWorkspaceGateway ? 300 : nextPollingDelay(createdAt, 'generation');
        if (delay === null || batchPollInFlight.current.has(batchId) || Date.now() - (batchLastPolled.current.get(batchId) ?? 0) < delay) return;
        batchPollInFlight.current.add(batchId);
        batchLastPolled.current.set(batchId, Date.now());
        await gateway.getGenerationBatch(batchId).then((batch) => {
          if (batch.status !== 'pending' && batch.status !== 'processing') {
            void refreshQuota().catch(() => undefined);
          }
          if (stopped) return;
          updateRuntime(sessionId, (runtime) => ({
            ...runtime,
            timeline: runtime.timeline.map((item) => (
              item.type === 'generation' && item.batch.id === batchId ? { ...item, batch } : item
            )),
          }));
        }).catch(() => undefined).finally(() => batchPollInFlight.current.delete(batchId));
      }));
    };
    const schedule = () => {
      const delays = pendingBatchEntries.map(entry => gateway instanceof MockWorkspaceGateway ? 300 : nextPollingDelay(entry.createdAt, 'generation'))
        .filter((value): value is number => value !== null);
      if (!delays.length || stopped) return;
      timer = window.setTimeout(async () => { await poll(); schedule(); }, Math.min(...delays));
    };
    schedule();
    window.addEventListener('focus', poll);
    document.addEventListener('visibilitychange', poll);
    return () => { stopped = true; if (timer !== undefined) window.clearTimeout(timer);
      window.removeEventListener('focus', poll); document.removeEventListener('visibilitychange', poll); };
  }, [gateway, pendingBatchKey, pendingBatchEntries, refreshQuota, updateRuntime]);

  const imageCreationEnabled = explicitImageToolEnabled;
  const selectedModel = findModelCapability(capabilities, selectedProvider, selectedModelId)?.model;
  const activeRuntime = activeSessionId ? runtimes[activeSessionId] : undefined;
  const pendingOnHome = Boolean(pendingFirstMessage && !activeSessionId);
  const activeBusy = Boolean(pendingOnHome || activeRuntime?.chatBusy || activeRuntime?.optimisticImages.some((turn) => turn.submitting));
  const composerDisabled = (initializing && (!route || route.kind === 'session')) || Boolean(activeSessionId && restoringAttachments[activeSessionId])
    || preparingReferences > 0 || activeRuntime?.loadStatus === 'loading' || activeRuntime?.loadStatus === 'error';
  const busySessionIds = useMemo(() => new Set(Object.entries(runtimes).flatMap(([sessionId, runtime]) => (
    runtime.chatBusy
      || runtime.optimisticImages.some((turn) => turn.submitting)
      || runtime.timeline.some((item) => item.type === 'generation' && ['pending', 'processing'].includes(item.batch.status))
      ? [sessionId]
      : []
  ))), [runtimes]);
  const timelineContentVersion = useMemo(() => {
    const timeline = activeRuntime?.timeline ?? [];
    return [
      timeline.map((item) => {
        if (item.type === 'message') return `${item.id}:${item.content.length}`;
        if (item.type === 'generation') {
          const assets = item.batch.assets.map((asset) => `${asset.id}:${asset.status}:${asset.expired ? 1 : 0}:${asset.url ?? ''}`).join(',');
          return `${item.id}:${item.batch.status}:${assets}`;
        }
        return `${item.id}:${item.error.code}`;
      }).join('|'),
      activeRuntime?.optimisticImages.map((turn) => `${turn.id}:${turn.batch.status}`).join('|') ?? '',
      activeRuntime?.streamingText.length ?? 0,
      activeRuntime?.awaitingFirstDelta ? 1 : 0,
    ].join('::');
  }, [activeRuntime]);
  const {
    containerRef: timelineScrollRef,
    handleScroll: handleTimelineScroll,
    handleUserScrollIntent,
    requestFollow,
    scrollToBottom,
    showScrollToBottom,
  } = useSmartAutoScroll({ contentVersion: timelineContentVersion, sessionId: activeSessionId, enabled: !commerceActive });

  const changeScenario = (value: typeof scenario) => {
    setScenario(value);
    if (gateway instanceof MockWorkspaceGateway) gateway.setScenario(value);
  };

  const createSession = async () => {
    if (onNavigate) {
      setActiveSessionId(undefined); setDraft(''); setReferences([]); onNavigate('/'); return;
    }
    try {
      const session = await gateway.createSession();
      updateRuntime(session.id, () => createRuntime('ready'));
      setActiveSessionId(session.id);
      await refreshSessions();
      setSessionDrawerOpen(false);
    } catch (error: unknown) {
      const safe = sanitizeError(error);
      if (safe.code !== 'UNAUTHORIZED') setFeedback({ error: safe, message: safe.message });
    }
  };

  const ensureSession = async (prompt: string, sourceVersion: number, sourceComposer: ComposerState) => {
    if (activeSessionId) return activeSessionId;
    const session = await gateway.createSession(prompt.slice(0, 100));
    updateSessions([session, ...sessionsRef.current.filter(item => item.id !== session.id)]);
    updateRuntime(session.id, () => createRuntime('ready'));
    useWorkspaceStore.setState(state => ({ composers: { ...state.composers, [session.id]: { ...sourceComposer, draft: '' } } }));
    if (selectionVersion.current === sourceVersion) {
      setActiveSessionId(session.id);
      onNavigate?.(sessionHref(session.id), true);
    }
    void refreshSessions().catch(() => undefined);
    return session.id;
  };

  const renameIfDefaultTitle = useCallback(async (sessionId: string, prompt: string) => {
    const current = sessionsRef.current.find((item) => item.id === sessionId);
    if (!current || current.title !== zhCN.workspace.defaultSessionTitle) return;
    try {
      const renamed = await gateway.renameSession(sessionId, prompt);
      updateSessions(sessionsRef.current.map((item) => (item.id === renamed.id ? renamed : item)));
    } catch {
      // Non-critical: the user can still rename manually from the sidebar.
    }
  }, [gateway, updateSessions]);

  const cleanupPreviewUrls = useCallback((urls: string[]) => {
    for (const previewUrl of urls) {
      if (localPreviewUrls.current.delete(previewUrl)) URL.revokeObjectURL(previewUrl);
    }
  }, []);

  const admitImageTurn = useCallback(async (sessionId: string, turnId: string, initialTurn?: OptimisticImageTurn) => {
    const turn = initialTurn ?? runtimesRef.current[sessionId]?.optimisticImages.find((item) => item.id === turnId);
    if (!turn) return;
    updateRuntime(sessionId, (runtime) => ({
      ...runtime,
      optimisticImages: runtime.optimisticImages.map((item) => item.id === turnId ? {
        ...item,
        batch: {
          ...item.batch,
          assets: item.batch.assets.map((asset) => ({ id: asset.id, status: 'pending' })),
          status: 'pending',
        },
        submitting: true,
      } : item),
    }));
    try {
      const batch = await gateway.submitImage(turn.request);
      updateRuntime(sessionId, (runtime) => ({
        ...runtime,
        optimisticImages: runtime.optimisticImages.filter((item) => item.id !== turnId),
        timeline: runtime.timeline.some((item) => item.type === 'generation' && item.batch.id === batch.id)
          ? runtime.timeline
          : [...runtime.timeline, {
              batch,
              createdAt: batch.createdAt,
              id: `local-generation-${batch.id}`,
              sequence: nextSequence(runtime.timeline),
              sessionId,
              type: 'generation' as const,
            }],
      }));
      cleanupPreviewUrls(turn.previewUrls);
      void refreshSessions();
      void refreshQuota().catch(() => undefined);
    } catch (error: unknown) {
      const safe = sanitizeError(error);
      const composer = useWorkspaceStore.getState();
      if (['QUOTA_EXCEEDED','CONFLICT'].includes(safe.code) && composer.activeComposerSessionId === sessionId && !composer.draft.trim()) {
        composer.setDraft(turn.request.prompt);
        if (!composer.references.length && turn.request.references?.length) composer.setReferences(turn.request.references.map((reference,index) => ({...reference,previewUrl:turn.previewUrls[index]})));
      }
      updateRuntime(sessionId, (runtime) => ({
        ...runtime,
        optimisticImages: runtime.optimisticImages.map((item) => item.id === turnId ? {
          ...item,
          batch: {
            ...item.batch,
            assets: item.batch.assets.map((asset) => ({ ...asset, error: safe, status: 'failed' })),
            status: 'failed',
          },
          submitting: false,
        } : item),
      }));
    }
  }, [cleanupPreviewUrls, gateway, refreshQuota, refreshSessions, updateRuntime]);

  const beginImageTurn = useCallback((sessionId: string, prompt: string, billing?: CreditConfirmation) => {
    const createdAt = new Date().toISOString();
    const turnId = `optimistic-image-${crypto.randomUUID()}`;
    const previewUrls = references.flatMap((reference) => reference.previewUrl ? [reference.previewUrl] : []);
    const request: ImageRequest = {
      billing,
      requestId: crypto.randomUUID(),
      aspectRatio,
      count: 1,
      model: selectedModelId,
      prompt,
      provider: selectedProvider,
      references: references.map((reference) => ({
        id: reference.id,
        file: reference.file,
        mimeType: reference.mimeType,
        name: reference.name,
        size: reference.size,
        status: reference.status,
      })),
      resolution,
      scenario,
      sessionId,
    };
    const turn: OptimisticImageTurn = {
      batch: {
        assets: Array.from({ length: 1 }, (_, index) => ({ id: `${turnId}-${index}`, status: 'pending' })),
        config: { aspectRatio, count: 1, resolution },
        createdAt,
        id: turnId,
        model: selectedModelId ?? 'unknown',
        prompt,
        provider: selectedProvider ?? 'unknown',
        sessionId,
        source: 'direct',
        status: 'pending',
      },
      id: turnId,
      previewUrls,
      request,
      submitting: true,
    };
    updateRuntime(sessionId, (runtime) => ({
      ...runtime,
      loadStatus: runtime.loadStatus === 'idle' ? 'ready' : runtime.loadStatus,
      optimisticImages: [...runtime.optimisticImages, turn],
    }));
    if (useWorkspaceStore.getState().activeComposerSessionId === sessionId) setReferences([]);
    else useWorkspaceStore.setState(state => ({ composers: { ...state.composers,
      ...(state.composers[sessionId] ? { [sessionId]: { ...state.composers[sessionId], references: [] } } : {}) } }));
    void renameIfDefaultTitle(sessionId, prompt);
    void admitImageTurn(sessionId, turnId, turn);
  }, [admitImageTurn, aspectRatio, references, renameIfDefaultTitle, resolution, scenario, selectedModelId, selectedProvider, updateRuntime, setReferences]);

  const runChat = useCallback(async (sessionId: string, request: ChatRequest, user: MessageTimelineItem, knownItemIds: string[]) => {
    const controller = new AbortController();
    chatControllers.current.set(sessionId, controller);
    const timeout = window.setTimeout(() => controller.abort('chat_stream_timeout'), CHAT_STREAM_TIMEOUT_MS);
    let finalText = '';
    let assistantMessageId: string | undefined;
    let completed = false;
    let streamFailure: SafeError | undefined;
    try {
      for await (const event of gateway.streamChat(request, controller.signal)) {
        if (event.type === 'message.delta') {
          assistantMessageId = event.messageId;
          finalText += event.delta;
          updateRuntime(sessionId, (runtime) => ({ ...runtime, awaitingFirstDelta: false, streamingText: finalText }));
        } else if (event.type === 'message.completed') {
          assistantMessageId = event.messageId;
          completed = true;
          finalText = event.content;
          break;
        } else if (event.type === 'stream.failed') {
          streamFailure = event.error;
          break;
        }
      }
    } catch (error: unknown) {
      if (!completed && !streamFailure) streamFailure = sanitizeError(error);
    } finally {
      window.clearTimeout(timeout);
      if (chatControllers.current.get(sessionId) === controller) chatControllers.current.delete(sessionId);
      if (!completed && !streamFailure) streamFailure = {
        code: 'STREAM_INTERRUPTED', message: '回复未完成，已保留收到的内容。请重试。', retryable: true,
      };
      if (streamFailure && ['QUOTA_EXCEEDED','CONFLICT'].includes(streamFailure.code)) {
        const composer = useWorkspaceStore.getState();
        if (composer.activeComposerSessionId === sessionId && !composer.draft.trim()) composer.setDraft(request.message);
      }
      updateRuntime(sessionId, (runtime) => {
        const additions: TimelineItem[] = [];
        if (finalText.trim()) additions.push({
          content: finalText, createdAt: new Date().toISOString(),
          id: assistantMessageId ?? `local-assistant-${crypto.randomUUID()}`, role: 'assistant',
          sequence: nextSequence(runtime.timeline), sessionId, type: 'message',
        });
        const failure: FailedChatAttempt | undefined = streamFailure ? {
          request, user, knownItemIds, assistantId: additions[0]?.id,
          error: {
            createdAt: new Date().toISOString(), error: streamFailure,
            id: `chat-error-${crypto.randomUUID()}`, sequence: nextSequence(runtime.timeline) + additions.length,
            sessionId, type: 'error',
          },
        } : undefined;
        if (failure) additions.push(failure.error);
        return {
          ...runtime, awaitingFirstDelta: false, chatBusy: false, isChatStreaming: false, streamingText: '',
          timeline: [...runtime.timeline, ...additions],
          retainedItems: failure ? [...runtime.retainedItems, user, ...additions] : runtime.retainedItems,
          chatFailures: failure ? [...runtime.chatFailures, failure] : runtime.chatFailures,
        };
      });
      void refreshTimeline(sessionId);
      void refreshSessions();
      void refreshQuota().catch(() => undefined);
    }
  }, [gateway, refreshQuota, refreshSessions, refreshTimeline, updateRuntime]);

  const beginChatTurn = useCallback((sessionId: string, prompt: string, originalRequest?: ChatRequest, billing?: CreditConfirmation) => {
    if (chatControllers.current.has(sessionId)) return;
    const knownItemIds = (runtimesRef.current[sessionId]?.timeline ?? []).map((item) => item.id);
    const user: MessageTimelineItem = {
      content: prompt, createdAt: new Date().toISOString(),
      id: `optimistic-user-${crypto.randomUUID()}`, role: 'user',
      sequence: nextSequence(runtimesRef.current[sessionId]?.timeline ?? []), sessionId, type: 'message',
    };
    const request: ChatRequest = originalRequest
      ? { ...originalRequest, scenario }
      : { requestId: crypto.randomUUID(), billing, chatModel: selectedChatModel, imageProvider: selectedProvider, imageToolEnabled: false, message: prompt, scenario, sessionId };
    updateRuntime(sessionId, (runtime) => ({
      ...runtime, awaitingFirstDelta: true, chatBusy: true, isChatStreaming: true,
      loadStatus: runtime.loadStatus === 'idle' ? 'ready' : runtime.loadStatus,
      streamingText: '', timeline: [...runtime.timeline, user],
    }));
    void renameIfDefaultTitle(sessionId, prompt);
    void runChat(sessionId, request, user, knownItemIds);
  }, [renameIfDefaultTitle, runChat, scenario, selectedChatModel, selectedProvider, updateRuntime]);

  const recoveryActions = chatRecoveryActions(activeRuntime?.timeline ?? [], activeRuntime?.chatFailures ?? []);
  const recoverChat = (errorId: string) => {
    if (!activeSessionId || activeBusy || composerDisabled || chatControllers.current.has(activeSessionId)) return;
    const action = recoveryActions[errorId];
    if (!action) return;
    if (!action.attempt) {
      if (draft.trim() && draft !== action.prompt) {
        setFeedback({ message: '输入区已有未发送内容，请先处理后再重新编辑。' });
        return;
      }
      setDraft(action.prompt);
      setExplicitImageToolEnabled(false);
      document.getElementById('creation-prompt')?.focus();
      return;
    }
    updateRuntime(activeSessionId, (runtime) => ({
      ...runtime, chatFailures: runtime.chatFailures.map((failure) => failure.error.id === action.attempt?.error.id ? { ...failure, retried: true } : failure),
    }));
    beginChatTurn(activeSessionId, action.prompt, action.attempt.request);
  };

  const submit = () => {
    const prompt = draft.trim();
    if (!prompt || activeBusy || composerDisabled || (!activeSessionId && firstSubmissionLock.current)) return;
    if (commerceRef.current?.edit(prompt)) { setDraft(''); return; }
    // The image switch is explicit generation intent; descriptions need no command prefix.
    const generate = imageCreationEnabled && !isCommerceDiscussion(prompt) && !hasTextOnlyImageIntent(prompt);
    if (generate && !findModelCapability(capabilities, selectedProvider, selectedModelId)) {
      setFeedback({ message: '所选图片模型已停止新生成，请主动更新为 Seedream 5.0 Pro。' });
      return;
    }
    const activeProvider = generate ? selectedProvider : selectedChatModel;
    if (health.find((item) => item.provider === activeProvider)?.status === 'unavailable') {
      const error: SafeError = { code: 'PROVIDER_UNAVAILABLE', message: '所选服务暂时不可用，请选择其他 provider。', retryable: true };
      setFeedback({ error, message: error.message });
      return;
    }
    let billing: CreditConfirmation | undefined;
    try {
      billing = credits.confirm(generate ? [imageCreditItem({provider:selectedProvider,model:selectedModelId,resolution,count:1})] : [{operation:'chat',provider:selectedChatModel,model:selectedChatModel,resolution:'',count:1}]);
    } catch(error) {
      setFeedback({message:error instanceof Error?error.message:'积分报价暂不可用。'});
      return;
    }
    setFeedback(undefined);
    setDraft('');
    requestFollow('smooth');
    const start = (sessionId: string) => {
      if (generate) beginImageTurn(sessionId, prompt, billing);
      else beginChatTurn(sessionId, prompt, undefined, billing);
    };
    if (activeSessionId) start(activeSessionId);
    else {
      firstSubmissionLock.current = true;
      const sourceVersion = selectionVersion.current;
      const sourceComposer = { ...snapshotComposer(useWorkspaceStore.getState()), draft: prompt };
      setPendingFirstMessage({ id: `pending-user-${crypto.randomUUID()}`, type: 'message', role: 'user',
        content: prompt, createdAt: new Date().toISOString(), sessionId: '', sequence: 1 });
      void ensureSession(prompt, sourceVersion, sourceComposer).then(start).catch((error: unknown) => {
        const safe = sanitizeError(error);
        if (safe.code === 'UNAUTHORIZED') return;
        setFeedback({ error: safe, message: safe.message });
        if (selectionVersion.current === sourceVersion || (!useWorkspaceStore.getState().activeComposerSessionId && !useWorkspaceStore.getState().draft)) setDraft(prompt);
        else useWorkspaceStore.setState(state => ({ composers: { ...state.composers, '': sourceComposer } }));
      }).finally(() => {
        firstSubmissionLock.current = false;
        setPendingFirstMessage(undefined);
      });
    }
  };

  const deleteSession = async (sessionId: string) => {
    if (deletionLock.current) return;
    deletionLock.current = true;
    setDeletingSessionId(sessionId);
    try {
      await gateway.deleteSession(sessionId);
      // A completed deletion stays completed even if refreshing the list fails.
      const next = await gateway.listSessions().catch(() => sessionsRef.current.filter((session) => session.id !== sessionId));
      updateSessions(next);
      setFeedback({ message: zhCN.workspace.deleteCompleted });
      chatControllers.current.get(sessionId)?.abort();
      chatControllers.current.delete(sessionId);
      removeRuntime(sessionId);
      const wasActive = useWorkspaceStore.getState().activeComposerSessionId === sessionId;
      forgetComposer(sessionId);
      if (wasActive) {
        const nextId = next[0]?.id;
        setActiveSessionId(nextId);
        onNavigate?.(nextId ? sessionHref(nextId) : "/", true);
        if (nextId) await refreshTimeline(nextId, true);
      }
    } catch (error: unknown) {
      const safe = sanitizeError(error);
      if (safe.code === 'UNAUTHORIZED') return;
      setFeedback({ error: safe, message: safe.message, retrySessionId: safe.retryable ? sessionId : undefined });
    } finally {
      deletionLock.current = false;
      setDeletingSessionId(undefined);
    }
  };

  const renameSession = async (sessionId: string, title: string) => {
    try {
      await gateway.renameSession(sessionId, title);
      await refreshSessions();
    } catch (error: unknown) {
      const safe = sanitizeError(error);
      if (safe.code !== 'UNAUTHORIZED') setFeedback({ error: safe, message: safe.message });
    }
  };

  const selectSession = (sessionId: string) => {
    if (onNavigate) { onNavigate(sessionHref(sessionId)); setSessionDrawerOpen(false); return; }
    setActiveSessionId(sessionId);
    void refreshTimeline(sessionId, true);
    setSessionDrawerOpen(false);
  };

  const recreate = async (batch: GenerationBatch, scope: RecreateScope, generationId?: string) => {
    try {
      const quantity = scope === 'single' ? 1 : batch.assets.filter(asset => scope === 'all' || (asset.status === 'failed' && asset.error?.code !== 'CONFLICT')).length;
      const billing = credits.confirm([imageCreditItem({provider:batch.provider,model:batch.model,resolution:batch.config.resolution,count:quantity})]);
      if (billing && !window.confirm(`重做 ${quantity} 张图片，本次 ${formatCredits(billing.totalMinor)} 积分。确认生成？`)) return;
      const nextBatch = await gateway.recreateGeneration({ batchId: batch.id, generationId, scope, requestId:crypto.randomUUID(), billing });
      updateRuntime(batch.sessionId, (runtime) => ({
        ...runtime,
        timeline: [...runtime.timeline, {
          batch: nextBatch,
          createdAt: nextBatch.createdAt,
          id: `local-generation-${nextBatch.id}`,
          sequence: nextSequence(runtime.timeline),
          sessionId: batch.sessionId,
          type: 'generation',
        }],
      }));
      void refreshQuota().catch(() => {
        setFeedback({ message: '图片任务已提交，额度暂未刷新；请稍后查看。' });
      });
    } catch (error: unknown) {
      const safe = sanitizeError(error);
      if (safe.code === 'UNAUTHORIZED') return;
      setFeedback({ error: safe, message: safe.message });
    }
  };

  const downloadBatch = async (batch: GenerationBatch) => {
    if (downloadingBatches.current.has(batch.id)) return;
    downloadingBatches.current.add(batch.id);
    setFeedback({ message: '正在准备图片下载…' });
    try {
      const assets = await Promise.all(batch.assets.map(async asset => {
        if (asset.status !== 'succeeded' || asset.expired || asset.url || !gateway.getGenerationAssetUrl) return asset;
        try { return { ...asset, url: await gateway.getGenerationAssetUrl(asset.id) }; }
        catch { return asset; }
      }));
      const result = await downloadImages({ ...batch, assets });
      setFeedback({ message: result.failed > 0
        ? `有 ${result.failed} 张图片下载失败，请刷新页面后重试。`
        : result.downloaded > 0 ? `已发起 ${result.downloaded} 张图片下载。` : '当前没有可下载的图片。' });
    } finally {
      downloadingBatches.current.delete(batch.id);
    }
  };
  const resolveAssetUrl = useMemo(() => gateway.getGenerationAssetUrl?.bind(gateway), [gateway]);
  const refreshGenerationBatch = async (target: GenerationBatch) => {
    try {
      const batch = await gateway.getGenerationBatch(target.id);
      updateRuntime(target.sessionId, runtime => ({ ...runtime, timeline: runtime.timeline.map(item =>
        item.type === 'generation' && item.batch.id === target.id ? { ...item, batch } : item) }));
      if (batch.status !== 'pending' && batch.status !== 'processing') void refreshQuota().catch(() => undefined);
    } catch { setFeedback({ message: '进度暂时无法刷新，请稍后重试。' }); }
  };

  const addReferences = async (files: FileList) => {
    const incoming = Array.from(files);
    const version = selectionVersion.current;
    const source = useWorkspaceStore.getState().activeComposerSessionId;
    const sourceRoute = routeRef.current;
    const needsPreparation = incoming.some(file => !ALLOWED_REFERENCE_TYPES.has(file.type) && file.size <= MAX_UPLOAD_BYTES);
    if (needsPreparation) setReferencePreparation(current => ({
      version, scope: referenceScope,
      count: current?.version === version && current.scope === referenceScope ? current.count + 1 : 1,
    }));
    const validFiles: Array<{ file: File; mimeType: string }> = [];
    let validationError: SafeError | undefined;
    try {
      for (const file of incoming) {
        if (file.size > MAX_UPLOAD_BYTES) {
          validationError ??= { code: 'VALIDATION_UPLOAD_SIZE', message: `${file.name} 超过 10 MB。`, retryable: false };
        } else if (ALLOWED_REFERENCE_TYPES.has(file.type)) validFiles.push({ file, mimeType: file.type });
        else {
          try {
            const prepared = await normalizeReferenceUploadFile(file);
            validFiles.push({ file, mimeType: prepared.type });
          } catch {
            validationError ??= { code: 'VALIDATION_UPLOAD_TYPE', message: `${file.name} 无法读取，仅支持 JPG、PNG 或 WebP。`, retryable: false };
          }
        }
      }
      // Decoding can finish after navigation or logout. Never attach its result to
      // a different composer or account, and enforce the limit against fresh state.
      const current = useWorkspaceStore.getState();
      if (selectionVersion.current !== version || current.activeComposerSessionId !== source || routeRef.current !== sourceRoute) return;
      const remaining = Math.max(0, maxActiveReferences - current.references.length);
      const acceptedFiles = validFiles.slice(0, remaining);
      if (validFiles.length > remaining) validationError = { code: 'VALIDATION_IMAGE_COUNT', message: `当前最多可添加 ${maxActiveReferences} 张参考图。`, retryable: false };
      const additions = acceptedFiles.map(({ file, mimeType }): UploadReference => {
        const previewUrl = URL.createObjectURL(file);
        localPreviewUrls.current.add(previewUrl);
        return { file, mimeType, name: file.name, previewUrl, size: file.size, status: 'ready' };
      });
      if (validationError) setFeedback({ error: validationError, message: validationError.message });
      setReferences((current) => [...current, ...additions]);
    } finally {
      if (needsPreparation) setReferencePreparation(current => current?.version === version && current.scope === referenceScope
        ? { ...current, count: current.count - 1 } : current);
    }
  };

  const removeReference = (index: number) => {
    setReferences((current) => {
      const reference = current[index];
      if (reference?.previewUrl) cleanupPreviewUrls([reference.previewUrl]);
      return current.filter((_, itemIndex) => itemIndex !== index);
    });
  };

  const selectModel = (provider: string, model: string) => {
    const normalized = normalizeGenerationSelection(capabilities, { aspectRatio, count: 1, model, provider, resolution });
    setAspectRatio(normalized.aspectRatio);
    setCount(normalized.count);
    setResolution(normalized.resolution);
    setSelectedProvider(normalized.provider);
    setSelectedModelId(normalized.model);
  };

  const sidebar = (collapsed = false) => (
    <SessionSidebar
      collapsed={collapsed}
      activeSessionId={activeSessionId}
      busySessionIds={busySessionIds}
      deleting={Boolean(deletingSessionId)}
      onCollapse={() => collapsed ? setSidebarCollapsed(false) : setSidebarCollapsed(true)}
      commerceDraftIds={commerceDraftIds}
      onCreate={() => void createSession()}
      onDelete={deleteSession}
      onRename={(sessionId, title) => void renameSession(sessionId, title)}
      onSelect={selectSession}
      sessions={sessions}
      loading={initializing}
      error={initializationError}
      onRetry={() => { setInitializationError(undefined); setInitializing(true); setInitializationAttempt(value => value + 1); }}
    />
  );
  const activeSession = sessions.find((session) => session.id === activeSessionId);
  const mobileConfig = (
    <div className={styles.mobileConfig}>
      {!imageCreationEnabled && <label><span className={styles.popoverLabel}>聊天模型</span><Select aria-label="移动端聊天模型" value={selectedChatModel} onChange={setSelectedChatModel} options={CHAT_PROVIDER_MODELS.map((model) => ({ label: model.label, value: model.id }))} /></label>}
      {imageCreationEnabled && (
        <>
          <label>
            <span className={styles.popoverLabel}>生成模型</span>
            <Select
              aria-label="移动端生成模型"
              onChange={(value) => { const [provider = '', model = ''] = value.split('::'); selectModel(provider, model); }}
              options={capabilities.flatMap((capability) => capability.models.map((model) => ({ label: `${capability.provider} · ${model.label}`, value: `${capability.provider}::${model.id}` })))}
              value={selectedProvider && selectedModelId ? `${selectedProvider}::${selectedModelId}` : undefined}
            />
          </label>
          <div><span className={styles.popoverLabel}>比例</span><div className={styles.mobileOptionGrid}>{selectedModel?.aspectRatios.map((ratio) => <Button key={ratio} onClick={() => setAspectRatio(ratio)} type={ratio === aspectRatio ? 'primary' : 'default'}>{ratio}</Button>)}</div></div>
          <div><span className={styles.popoverLabel}>分辨率</span><div className={styles.mobileOptionGrid}>{selectedModel?.resolutions.map((item) => <Button key={item} onClick={() => setResolution(item)} type={item === resolution ? 'primary' : 'default'}>{item}</Button>)}</div></div>
        </>
      )}
    </div>
  );

  return (
    <>
    <WorkspaceFrame collapsed={sidebarCollapsed} sidebar={sidebar(sidebarCollapsed)} header={
          <header className={styles.header}>
          <NavGlassFilter />
          <Space><Button aria-label="打开会话" className={styles.mobileControl} icon={<Menu size={18} />} onClick={() => setSessionDrawerOpen(true)} type="text" /><span className={styles.headerTitle}>{catalogueActive ? '电商生图' : commerceShell ? COMMERCE_SCENES.find(item => item.id === (route?.kind === 'commerce' ? route.scene : commerceMode?.scene))?.name ?? '电商生图' : activeSession?.title ?? zhCN.workspace.creationTitle}</span></Space>
          <Space>
            <CreditBalance /><Link href="/create">{commerceShell && !catalogueActive ? '返回工具目录' : '电商生图'}</Link><Link href="/account">账号</Link>
            {gateway instanceof MockWorkspaceGateway && (
              <Select aria-label={zhCN.workspace.mockScenario} className={styles.devScenario} onChange={changeScenario} options={[
                { label: 'Mock · 正常', value: 'happy' }, { label: 'Mock · 部分成功', value: 'partial' }, { label: 'Mock · 服务不可用', value: 'provider-unavailable' }, { label: 'Mock · 资源过期', value: 'expired' }, { label: 'Mock · 删除重试', value: 'delete-retry' },
              ]} size="small" value={scenario} />
            )}
            <Button aria-label={zhCN.workspace.assetLibrary} className={styles.assetLibraryButton} icon={<Archive size={16} />} onClick={() => setFeedback({ message: zhCN.workspace.assetLibraryUnavailable })}>{zhCN.workspace.assetLibrary}</Button>
          </Space>
        </header>
      }>
        {catalogueActive && <CommerceCatalogue />}
        {gateway instanceof MockWorkspaceGateway && <div className={styles.previewNotice} role="note">模拟预览 · 不调用真实模型，不消耗真实额度</div>}
        {feedback && <div className={styles.statusFeedback}><Alert action={feedback.retrySessionId ? <Button onClick={() => void deleteSession(feedback.retrySessionId!)} size="small">重试清理</Button> : undefined} closable onClose={() => setFeedback(undefined)} role="alert" showIcon title={feedback.message} type={feedback.error ? 'error' : 'info'} /></div>}
        {(quotaError || modelsError || !quota || modelsLoading) && <div className={styles.bootstrapStatus} role="status">
          {quotaError ? <span>额度暂不可用 <button type="button" onClick={() => setQuotaAttempt(value => value + 1)}>重试额度</button></span> : !quota ? <span>正在加载额度…</span> : null}
          {modelsError ? <span>模型状态暂不可用 <button type="button" onClick={() => { setModelsLoading(true); setModelsAttempt(value => value + 1); }}>重试模型</button></span> : modelsLoading ? <span>正在加载模型配置…</span> : null}
        </div>}
        {routeError && <div className={styles.statusFeedback} role="alert">{routeError} <Link href="/create">返回创作目录</Link></div>}
        <div className={styles.workspaceBody} hidden={Boolean(routeError) || catalogueActive}>
        {/* Release the preview overlay even when the CSS transition-end event is lost. */}
        <PreviewGroup preview={{ motionName: '' }}>
          <div aria-label="对话时间线" className={`${styles.timelineScroll} ${commerceActive ? styles.commerceScroll : ""}`} onPointerDown={handleUserScrollIntent} onScroll={handleTimelineScroll} onTouchMove={handleUserScrollIntent} onWheel={handleUserScrollIntent} ref={timelineScrollRef} role="log">
            {legacyCommercePending ? <div className={styles.statusFeedback} role={initializationError ? 'alert' : 'status'}>
              {initializationError ? <><strong>暂时无法打开创作空间</strong><p>{initializationError}</p><button type="button" onClick={() => { setInitializationError(undefined); setInitializing(true); setInitializationAttempt(value => value + 1); }}>重新打开</button></> : '正在打开电商工作台…'}
            </div> : <CommerceWorkspace
              ensureSession={ensureCommerceSession}
              onSavedSession={commerceSaved}
              onExitDraft={() => onNavigate?.('/create')}
              ownerKey={ownerKey}
              onDraftSessionsChange={onDraftSessionsChange}
              requestedTaskId={route?.kind === 'session' ? route.taskId : undefined}
              requestedBatchId={route?.kind === 'session' ? route.batchId : undefined}
              requestedView={route?.kind === 'session' ? route.view : undefined}
              routeDriven={Boolean(route)}
              onViewChange={(id, task, view) => { if (onNavigate && !isLocalCommerceDraft(id)) onNavigate(sessionHref(id, task, view)); }}
              ref={commerceRef} gateway={gateway.commerce} sessionId={activeSessionId} launch={commerceLaunch} onModeChange={onCommerceModeChange} onTaskChanged={refreshSessions}
              items={activeRuntime?.timeline ?? []} references={references} capabilities={commerceCapabilities}
              timelineLoading={(initializing && (!route || route.kind === 'session')) || activeRuntime?.loadStatus === 'loading'}
              settings={{ provider: selectedProvider ?? 'seedream', model: selectedModelId ?? 'doubao-seedream-5.0-pro', aspectRatio, resolution }}
              onReferenceAdd={addReferences} onReferenceRemove={removeReference} referencesPreparing={preparingReferences > 0}
              onReferencesAdopt={(next, sessionId) => {
                const current = useWorkspaceStore.getState();
                if (current.activeComposerSessionId !== sessionId) return false;
                const merged = [...current.references, ...next.filter((reference) => !current.references.some((item) => reference.id ? item.id === reference.id : item === reference))];
                if (merged.length > maxActiveReferences) return false;
                setReferences(merged);
                return true;
              }}
              onReferenceUploaded={(reference, id, sessionId) => {
                if (useWorkspaceStore.getState().activeComposerSessionId === sessionId) setReferences((current) => current.map((item) => item === reference ? { ...item, id } : item));
              }}
              renderTimeline={(items, tail, hasCommerce, loading) => {
                if (tail && hasCommerce && !loading && !activeRuntime?.loadError && !activeRuntime?.streamingText && !activeRuntime?.awaitingFirstDelta && !activeRuntime?.optimisticImages.length) return null;
                return (
                  <WorkspaceTimeline
                    resolveAssetUrl={resolveAssetUrl}
                    onRefreshBatch={(batch) => void refreshGenerationBatch(batch)}
                    awaitingFirstDelta={pendingOnHome || (tail && activeRuntime?.awaitingFirstDelta)}
                    isChatStreaming={tail && activeRuntime?.isChatStreaming}
                    items={pendingOnHome && pendingFirstMessage ? [pendingFirstMessage] : items}
                    loadError={tail ? activeRuntime?.loadError?.message : undefined}
                    loading={loading}
                    onDownloadBatch={downloadBatch}
                    onRecreate={(batch, scope, generationId) => void recreate(batch, scope, generationId)}
                    chatRecoveryActions={recoveryActions}
                    chatRecoveryDisabled={activeBusy || composerDisabled}
                    onRecoverChat={recoverChat}
                    onRetryImage={(turnId) => activeSessionId && void admitImageTurn(activeSessionId, turnId)}
                    onRetryLoad={() => activeSessionId && void refreshTimeline(activeSessionId, true)}
                    onInspiration={(prompt) => { setDraft(prompt); setExplicitImageToolEnabled(true); document.getElementById('creation-prompt')?.focus(); }}
                    optimisticImages={tail ? activeRuntime?.optimisticImages ?? [] : []}
                    streamingText={tail ? activeRuntime?.streamingText ?? '' : ''}
                  />
                );
              }}
            />}
          </div>
          {!legacyCommercePending && !commerceActive && !(commerceLaunch?.sessionId === activeSessionId && commerceMode?.sessionId !== activeSessionId) && <div className={styles.composerDock}>
            {showScrollToBottom && <Button aria-label="回到底部" className={styles.scrollToBottom} icon={<ArrowDown size={17} />} onClick={() => scrollToBottom('smooth')} shape="circle" />}
            {imageCreationEnabled && !modelsLoading && capabilities.length > 0 && !selectedModel && <p role="alert">
              当前草稿的图片模型已停止新生成，请主动更新模型后发送。
              <Button onClick={() => { const current = capabilities[0]; const model = current?.models[0]; if (current && model) selectModel(current.provider, model.id); }}>更新为 Seedream 5.0 Pro</Button>
            </p>}
            <UnifiedComposer
              activePopover={activePopover}
              aspectRatio={aspectRatio}
              busy={activeBusy}
              capabilities={capabilities}
              disabled={composerDisabled || pendingOnHome}
              submitDisabled={(imageCreationEnabled && (!quota || modelsLoading || Boolean(modelsError) || !selectedModel)) || (credits.present && credits.catalog?.enabled !== false && (!credits.catalog || !credits.wallet || Boolean(credits.error)))}
              draft={draft}
              health={health}
              imageCreationEnabled={imageCreationEnabled}
              onAspectRatioChange={setAspectRatio}
              onChatModelSelect={setSelectedChatModel}
              onDraftChange={setDraft}
              onImageCreationChange={(enabled) => { setActivePopover(undefined); setExplicitImageToolEnabled(enabled); }}
              onModelSelect={selectModel}
              onOpenConfig={() => setConfigDrawerOpen(true)}
              onPopoverChange={setActivePopover}
              onReferenceAdd={addReferences}
              onReferenceRemove={removeReference}
              onResolutionChange={setResolution}
              onSubmit={submit}
              quota={quota}
              references={references}
              resolution={resolution}
              selectedChatModel={selectedChatModel}
              selectedModel={selectedModel}
              selectedProvider={selectedProvider}
            />
          </div>}
        </PreviewGroup>
        </div>
      <Drawer className="workspaceDrawer" onClose={() => setSessionDrawerOpen(false)} open={sessionDrawerOpen} placement="left" size={320} title={zhCN.workspace.sessions}>{sidebar()}</Drawer>
      <Drawer className="workspaceDrawer" onClose={() => setConfigDrawerOpen(false)} open={configDrawerOpen} placement="right" size={420} title={zhCN.workspace.generationConfig}>{mobileConfig}</Drawer>
    </WorkspaceFrame>
    </>
  );
}
