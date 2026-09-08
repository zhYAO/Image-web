'use client';

import {
  CHAT_PROVIDER_MODELS,
  hasTextOnlyImageIntent,
  MAX_UPLOAD_BYTES,
  sanitizeError,
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
import { Archive, ArrowDown, ChevronRight, Menu } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { CommerceWorkspace, type CommerceWorkspaceHandle, type CommerceLaunch } from '@/features/commerce/CommerceWorkspace';
import { isCommerceDiscussion, resolveCommerceLaunch } from '@/features/commerce/commerce-ui';

import { getWorkspaceGateway } from '@/gateways';
import { MockWorkspaceGateway } from '@/gateways/mock-workspace-gateway';
import { zhCN } from '@/i18n';
import { useWorkspaceStore, type ComposerState } from '@/store/workspace-store';

import { findModelCapability, normalizeGenerationSelection } from './GenerationConfig';
import { SessionSidebar } from './SessionSidebar';
import { downloadImages } from './download-images';
import { UnifiedComposer } from './UnifiedComposer';
import { useSmartAutoScroll } from './use-smart-auto-scroll';
import { WorkspaceTimeline, type OptimisticImageTurnView } from './WorkspaceTimeline';
import styles from './workspace.module.css';
import Link from 'next/link';
import { WorkspaceLoading } from './WorkspaceLoading';

interface UnifiedWorkspaceProps {
  gateway?: WorkspaceGateway;
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
});

const nextSequence = (items: TimelineItem[]) => (
  items.reduce((maximum, item) => Math.max(maximum, item.sequence), 0) + 1
);

export function UnifiedWorkspace({ gateway: providedGateway }: UnifiedWorkspaceProps) {
  const gateway = useMemo(() => providedGateway ?? getWorkspaceGateway(), [providedGateway]);
  const {
    activateComposer,
    forgetComposer,
    aspectRatio, setAspectRatio,
    resolution, setResolution,
    count, setCount,
    selectedProvider, setSelectedProvider,
    selectedModelId, setSelectedModelId,
    selectedChatModel, setSelectedChatModel,
    references, setReferences,
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
  const [initializationAttempt, setInitializationAttempt] = useState(0);
  const [deletingSessionId, setDeletingSessionId] = useState<string>();
  const deletionLock = useRef(false);
  const sessionsRef = useRef<Session[]>([]);
  const [activeSessionId, setActiveSessionState] = useState<string>();
  const composerDefaults = useRef<Partial<ComposerState>>({});
  const setActiveSessionId = useCallback((id?: string, inheritCurrent = false) => {
    activateComposer(id, composerDefaults.current, inheritCurrent);
    setActiveSessionState(id);
  }, [activateComposer]);
  const [runtimes, setRuntimes] = useState<Record<string, SessionRuntime>>({});
  const runtimesRef = useRef<Record<string, SessionRuntime>>({});
  const timelineRequestVersions = useRef(new Map<string, number>());
  const chatControllers = useRef(new Map<string, AbortController>());
  const [quota, setQuota] = useState<Quota>();
  const [capabilities, setCapabilities] = useState<ProviderCapability[]>([]);
  const [health, setHealth] = useState<ProviderHealth[]>([]);
  const [feedback, setFeedback] = useState<{ error?: SafeError; message: string; retrySessionId?: string }>();
  const localPreviewUrls = useRef(new Set<string>());
  const downloadingBatches = useRef(new Set<string>());
  const commerceRef = useRef<CommerceWorkspaceHandle>(null);
  const [commerceLaunch, setCommerceLaunch] = useState<CommerceLaunch>();
  const [commerceMode, setCommerceMode] = useState<{ sessionId?: string; active: boolean }>();
  const commerceActive = commerceMode?.sessionId === activeSessionId && Boolean(commerceMode?.active);
  const onCommerceModeChange = useCallback((sessionId: string | undefined, active: boolean) => {
    setCommerceMode((current) => current?.sessionId === sessionId && current?.active === active ? current : { sessionId, active });
  }, []);

  const updateSessions = useCallback((next: Session[]) => {
    sessionsRef.current = next;
    setSessions(next);
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
    const next = await gateway.listSessions();
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
      updateRuntime(sessionId, (runtime) => ({ ...runtime, loadError: undefined, loadStatus: 'ready', timeline: [...timeline, ...runtime.retainedItems.filter((item) => !timeline.some((saved) => saved.id === item.id))] }));
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
      const [nextSessions, nextQuota, nextCapabilities, nextHealth] = await Promise.all([
        gateway.listSessions(),
        gateway.getQuota(),
        gateway.getProviderCapabilities(),
        gateway.getProviderHealth(),
      ]);
      if (cancelled) return;
      updateSessions(nextSessions);
      setQuota(nextQuota);
      setCapabilities(nextCapabilities);
      setHealth(nextHealth);
      const availableCapabilities = nextCapabilities.filter(
        (capability) => nextHealth.find((item) => item.provider === capability.provider)?.status !== 'unavailable',
      );
      const initialSelection = normalizeGenerationSelection(
        availableCapabilities.length > 0 ? availableCapabilities : nextCapabilities,
        { aspectRatio: '1:1', count: 2, resolution: '2K' },
      );
      composerDefaults.current = {
        aspectRatio: initialSelection.aspectRatio, count: initialSelection.count,
        resolution: initialSelection.resolution, selectedProvider: initialSelection.provider,
        selectedModelId: initialSelection.model,
      };
      setAspectRatio(initialSelection.aspectRatio);
      setCount(initialSelection.count);
      setResolution(initialSelection.resolution);
      setSelectedProvider(initialSelection.provider);
      setSelectedModelId(initialSelection.model);
      const launchUrl = new URL(window.location.href);
      const launchCommerce = resolveCommerceLaunch(launchUrl.search);
      const launchScene = launchCommerce.scene;
      let initialId = nextSessions[0]?.id;
      if (launchScene) {
        const session = await gateway.createSession();
        if (cancelled) return;
        updateSessions([session, ...nextSessions]);
        initialId = session.id;
      }
      setActiveSessionId(initialId);
      if (launchScene && initialId) {
        setCommerceLaunch({ scene: launchScene, platform: launchCommerce.platform, sessionId: initialId });
      }
      // Legacy Skill links must never implicitly open a commerce workflow.
      if (launchUrl.searchParams.has('skill')) {
        launchUrl.searchParams.delete('skill');
        launchUrl.searchParams.delete('new');
        window.history.replaceState(window.history.state, '', `${launchUrl.pathname}${launchUrl.search}${launchUrl.hash}`);
      }
      if (launchScene) {
        launchUrl.searchParams.delete('scene');
        launchUrl.searchParams.delete('platform');
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

  useEffect(
    () => () => {
      for (const previewUrl of localPreviewUrls.current) URL.revokeObjectURL(previewUrl);
      localPreviewUrls.current.clear();
      for (const controller of chatControllers.current.values()) controller.abort();
      chatControllers.current.clear();
    },
    [],
  );

  const pendingBatchEntries = useMemo(() => Object.entries(runtimes).flatMap(([sessionId, runtime]) => (
    runtime.timeline.flatMap((item) => (
      item.type === 'generation' && (item.batch.status === 'pending' || item.batch.status === 'processing')
        ? [{ batchId: item.batch.id, sessionId }]
        : []
    ))
  )), [runtimes]);
  const pendingBatchKey = pendingBatchEntries.map((entry) => `${entry.sessionId}:${entry.batchId}`).join('|');

  useEffect(() => {
    if (!pendingBatchKey) return;
    const poll = () => {
      for (const { batchId, sessionId } of pendingBatchEntries) {
        void gateway.getGenerationBatch(batchId).then((batch) => {
          updateRuntime(sessionId, (runtime) => ({
            ...runtime,
            timeline: runtime.timeline.map((item) => (
              item.type === 'generation' && item.batch.id === batchId ? { ...item, batch } : item
            )),
          }));
        }).catch(() => undefined);
      }
    };
    const timer = window.setInterval(poll, gateway instanceof MockWorkspaceGateway ? 300 : 1500);
    return () => window.clearInterval(timer);
  }, [gateway, pendingBatchKey, pendingBatchEntries, updateRuntime]);

  const imageCreationEnabled = explicitImageToolEnabled;
  const selectedModel = findModelCapability(capabilities, selectedProvider, selectedModelId)?.model;
  const activeRuntime = activeSessionId ? runtimes[activeSessionId] : undefined;
  const activeBusy = Boolean(activeRuntime?.chatBusy || activeRuntime?.optimisticImages.some((turn) => turn.submitting));
  const composerDisabled = initializing || activeRuntime?.loadStatus === 'loading' || activeRuntime?.loadStatus === 'error';
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

  const ensureSession = async (prompt: string) => {
    if (activeSessionId) return activeSessionId;
    const session = await gateway.createSession(prompt);
    updateRuntime(session.id, () => createRuntime('ready'));
    setActiveSessionId(session.id, true);
    await refreshSessions();
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
      void gateway.getQuota().then(setQuota).catch(() => undefined);
    } catch (error: unknown) {
      const safe = sanitizeError(error);
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
  }, [cleanupPreviewUrls, gateway, refreshSessions, updateRuntime]);

  const beginImageTurn = useCallback((sessionId: string, prompt: string) => {
    const createdAt = new Date().toISOString();
    const turnId = `optimistic-image-${crypto.randomUUID()}`;
    const previewUrls = references.flatMap((reference) => reference.previewUrl ? [reference.previewUrl] : []);
    const request: ImageRequest = {
      requestId: crypto.randomUUID(),
      aspectRatio,
      count,
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
        assets: Array.from({ length: count }, (_, index) => ({ id: `${turnId}-${index}`, status: 'pending' })),
        config: { aspectRatio, count, resolution },
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
    setReferences([]);
    void renameIfDefaultTitle(sessionId, prompt);
    void admitImageTurn(sessionId, turnId, turn);
  }, [admitImageTurn, aspectRatio, count, references, renameIfDefaultTitle, resolution, scenario, selectedModelId, selectedProvider, updateRuntime, setReferences]);

  const runChat = useCallback(async (sessionId: string, prompt: string) => {
    const controller = new AbortController();
    chatControllers.current.set(sessionId, controller);
    const timeout = window.setTimeout(() => controller.abort('chat_stream_timeout'), CHAT_STREAM_TIMEOUT_MS);
    let finalText = '';
    let completed = false;
    let streamFailure: SafeError | undefined;
    try {
      for await (const event of gateway.streamChat({
        chatModel: selectedChatModel,
        imageProvider: selectedProvider,
        imageToolEnabled: false,
        message: prompt,
        scenario,
        sessionId,
      }, controller.signal)) {
        if (event.type === 'message.delta') {
          finalText += event.delta;
          updateRuntime(sessionId, (runtime) => ({ ...runtime, awaitingFirstDelta: false, streamingText: finalText }));
        } else if (event.type === 'message.completed') {
          completed = true;
          finalText = event.content;
        } else if (event.type === 'stream.failed') {
          streamFailure = event.error;
        }
      }
    } catch (error: unknown) {
      streamFailure = sanitizeError(error);
    } finally {
      window.clearTimeout(timeout);
      if (chatControllers.current.get(sessionId) === controller) chatControllers.current.delete(sessionId);
      if (!completed && !streamFailure) streamFailure = {
        code: 'STREAM_INTERRUPTED', message: '回复未完成，已保留收到的内容。请重试。', retryable: true,
      };
      updateRuntime(sessionId, (runtime) => {
        const additions: TimelineItem[] = [];
        if (finalText.trim()) additions.push({
          content: finalText, createdAt: new Date().toISOString(),
          id: `local-assistant-${crypto.randomUUID()}`, role: 'assistant',
          sequence: nextSequence(runtime.timeline), sessionId, type: 'message',
        });
        if (streamFailure) additions.push({
          createdAt: new Date().toISOString(), error: streamFailure,
          id: `chat-error-${crypto.randomUUID()}`, sequence: nextSequence(runtime.timeline) + additions.length,
          sessionId, type: 'error',
        });
        return {
          ...runtime, awaitingFirstDelta: false, chatBusy: false, isChatStreaming: false, streamingText: '',
          timeline: [...runtime.timeline, ...additions],
          retainedItems: streamFailure ? [...runtime.retainedItems, ...additions] : runtime.retainedItems,
        };
      });
      void refreshTimeline(sessionId);
      void refreshSessions();
      void gateway.getQuota().then(setQuota).catch(() => undefined);
    }
  }, [gateway, refreshSessions, refreshTimeline, scenario, selectedChatModel, selectedProvider, updateRuntime]);

  const beginChatTurn = useCallback((sessionId: string, prompt: string) => {
    updateRuntime(sessionId, (runtime) => ({
      ...runtime,
      awaitingFirstDelta: true,
      chatBusy: true,
      isChatStreaming: true,
      loadStatus: runtime.loadStatus === 'idle' ? 'ready' : runtime.loadStatus,
      streamingText: '',
      timeline: [...runtime.timeline, {
        content: prompt,
        createdAt: new Date().toISOString(),
        id: `optimistic-user-${crypto.randomUUID()}`,
        role: 'user',
        sequence: nextSequence(runtime.timeline),
        sessionId,
        type: 'message',
      }],
    }));
    void renameIfDefaultTitle(sessionId, prompt);
    void runChat(sessionId, prompt);
  }, [renameIfDefaultTitle, runChat, updateRuntime]);

  const submit = () => {
    const prompt = draft.trim();
    if (!prompt || activeBusy || composerDisabled) return;
    if (commerceRef.current?.edit(prompt)) { setDraft(''); return; }
    // The image switch is explicit generation intent; descriptions need no command prefix.
    const generate = imageCreationEnabled && !isCommerceDiscussion(prompt) && !hasTextOnlyImageIntent(prompt);
    const activeProvider = generate ? selectedProvider : selectedChatModel;
    if (health.find((item) => item.provider === activeProvider)?.status === 'unavailable') {
      const error: SafeError = { code: 'PROVIDER_UNAVAILABLE', message: '所选服务暂时不可用，请选择其他 provider。', retryable: true };
      setFeedback({ error, message: error.message });
      return;
    }
    setFeedback(undefined);
    setDraft('');
    requestFollow('smooth');
    const start = (sessionId: string) => {
      if (generate) beginImageTurn(sessionId, prompt);
      else beginChatTurn(sessionId, prompt);
    };
    if (activeSessionId) start(activeSessionId);
    else void ensureSession(prompt).then(start).catch((error: unknown) => {
      const safe = sanitizeError(error);
      if (safe.code === 'UNAUTHORIZED') return;
      setFeedback({ error: safe, message: safe.message });
      setDraft(prompt);
    });
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
    setActiveSessionId(sessionId);
    void refreshTimeline(sessionId, true);
    setSessionDrawerOpen(false);
  };

  const recreate = async (batch: GenerationBatch, scope: RecreateScope, generationId?: string) => {
    try {
      const nextBatch = await gateway.recreateGeneration({ batchId: batch.id, generationId, scope });
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
      const result = await downloadImages(batch);
      setFeedback({ message: result.failed > 0
        ? `有 ${result.failed} 张图片下载失败，请刷新页面后重试。`
        : result.downloaded > 0 ? `已发起 ${result.downloaded} 张图片下载。` : '当前没有可下载的图片。' });
    } finally {
      downloadingBatches.current.delete(batch.id);
    }
  };

  const addReferences = (files: FileList) => {
    const validFiles: File[] = [];
    let validationError: SafeError | undefined;
    for (const file of Array.from(files)) {
      if (!ALLOWED_REFERENCE_TYPES.has(file.type)) {
        validationError ??= { code: 'VALIDATION_UPLOAD_TYPE', message: `${file.name} 格式不支持，仅支持 JPG、PNG 或 WebP。`, retryable: false };
      } else if (file.size > MAX_UPLOAD_BYTES) {
        validationError ??= { code: 'VALIDATION_UPLOAD_SIZE', message: `${file.name} 超过 10 MB。`, retryable: false };
      } else validFiles.push(file);
    }
    const remaining = Math.max(0, MAX_REFERENCES - references.length);
    const acceptedFiles = validFiles.slice(0, remaining);
    if (validFiles.length > remaining) validationError = { code: 'VALIDATION_IMAGE_COUNT', message: '最多可添加 4 张参考图。', retryable: false };
    const additions = acceptedFiles.map((file): UploadReference => {
      const previewUrl = URL.createObjectURL(file);
      localPreviewUrls.current.add(previewUrl);
      return { file, mimeType: file.type, name: file.name, previewUrl, size: file.size, status: 'ready' };
    });
    if (validationError) setFeedback({ error: validationError, message: validationError.message });
    setReferences((current) => [...current, ...additions]);
  };

  const removeReference = (index: number) => {
    setReferences((current) => {
      const reference = current[index];
      if (reference?.previewUrl) cleanupPreviewUrls([reference.previewUrl]);
      return current.filter((_, itemIndex) => itemIndex !== index);
    });
  };

  const selectModel = (provider: string, model: string) => {
    const normalized = normalizeGenerationSelection(capabilities, { aspectRatio, count, model, provider, resolution });
    setAspectRatio(normalized.aspectRatio);
    setCount(normalized.count);
    setResolution(normalized.resolution);
    setSelectedProvider(normalized.provider);
    setSelectedModelId(normalized.model);
  };

  const sidebar = (
    <SessionSidebar
      activeSessionId={activeSessionId}
      busySessionIds={busySessionIds}
      deleting={Boolean(deletingSessionId)}
      onCollapse={() => setSidebarCollapsed(true)}
      onCreate={() => void createSession()}
      onDelete={deleteSession}
      onRename={(sessionId, title) => void renameSession(sessionId, title)}
      onSelect={selectSession}
      sessions={sessions}
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
          <div><span className={styles.popoverLabel}>数量</span><div className={styles.mobileOptionGrid}>{Array.from({ length: Math.min(selectedModel?.maxImages ?? 1, 4) }, (_, index) => index + 1).map((item) => <Button key={item} onClick={() => setCount(item)} type={item === count ? 'primary' : 'default'}>{item}</Button>)}</div></div>
        </>
      )}
    </div>
  );

  return (
    <>
    {(initializing || initializationError) && <WorkspaceLoading error={initializationError} onRetry={() => { setInitializationError(undefined); setFeedback(undefined); setInitializing(true); setInitializationAttempt((value) => value + 1); }} />}
    <div style={initializing || initializationError ? { display: 'none' } : undefined} aria-hidden={Boolean(initializing || initializationError) || undefined} className={`${styles.workspace} ${sidebarCollapsed ? styles.workspaceCollapsed : ''}`}>
      <aside className={styles.sidebar}>
        {sidebarCollapsed ? <Button aria-label="展开会话侧栏" className={styles.expandSidebar} icon={<ChevronRight size={18} />} onClick={() => setSidebarCollapsed(false)} type="text" /> : sidebar}
      </aside>
      <main className={styles.main}>
        <header className={styles.header}>
          <Space><Button aria-label="打开会话" className={styles.mobileControl} icon={<Menu size={18} />} onClick={() => setSessionDrawerOpen(true)} type="text" /><span className={styles.headerTitle}>{activeSession?.title ?? zhCN.workspace.creationTitle}</span></Space>
          <Space>
            <Link href="/create">电商生图</Link><Link href="/account">账号</Link>
            {gateway instanceof MockWorkspaceGateway && (
              <Select aria-label={zhCN.workspace.mockScenario} className={styles.devScenario} onChange={changeScenario} options={[
                { label: 'Mock · 正常', value: 'happy' }, { label: 'Mock · 部分成功', value: 'partial' }, { label: 'Mock · 服务不可用', value: 'provider-unavailable' }, { label: 'Mock · 资源过期', value: 'expired' }, { label: 'Mock · 删除重试', value: 'delete-retry' },
              ]} size="small" value={scenario} />
            )}
            <Button aria-label={zhCN.workspace.assetLibrary} className={styles.assetLibraryButton} icon={<Archive size={16} />} onClick={() => setFeedback({ message: zhCN.workspace.assetLibraryUnavailable })}>{zhCN.workspace.assetLibrary}</Button>
          </Space>
        </header>
        {gateway instanceof MockWorkspaceGateway && <div className={styles.previewNotice} role="note">模拟预览 · 不调用真实模型，不消耗真实额度</div>}
        {feedback && <div className={styles.statusFeedback}><Alert action={feedback.retrySessionId ? <Button onClick={() => void deleteSession(feedback.retrySessionId!)} size="small">重试清理</Button> : undefined} closable onClose={() => setFeedback(undefined)} role="alert" showIcon title={feedback.message} type={feedback.error ? 'error' : 'info'} /></div>}
        <PreviewGroup>
          <div aria-label="对话时间线" className={styles.timelineScroll} onPointerDown={handleUserScrollIntent} onScroll={handleTimelineScroll} onTouchMove={handleUserScrollIntent} onWheel={handleUserScrollIntent} ref={timelineScrollRef} role="log">
            <CommerceWorkspace
              ref={commerceRef} gateway={gateway.commerce} sessionId={activeSessionId} launch={commerceLaunch} onModeChange={onCommerceModeChange}
              items={activeRuntime?.timeline ?? []} references={references} capabilities={capabilities}
              timelineLoading={initializing || activeRuntime?.loadStatus === 'loading'}
              settings={{ provider: selectedProvider ?? 'gemini', model: selectedModelId ?? 'gemini-3-pro-image', aspectRatio, resolution }}
              onReferenceAdd={addReferences} onReferenceRemove={removeReference}
              onReferencesAdopt={(next, sessionId) => {
                const current = useWorkspaceStore.getState();
                if (current.activeComposerSessionId !== sessionId) return false;
                const merged = [...current.references, ...next.filter((reference) => !current.references.some((item) => reference.id ? item.id === reference.id : item === reference))];
                if (merged.length > MAX_REFERENCES) return false;
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
                    awaitingFirstDelta={tail && activeRuntime?.awaitingFirstDelta}
                    isChatStreaming={tail && activeRuntime?.isChatStreaming}
                    items={items}
                    loadError={tail ? activeRuntime?.loadError?.message : undefined}
                    loading={loading}
                    onDownloadBatch={downloadBatch}
                    onRecreate={(batch, scope, generationId) => void recreate(batch, scope, generationId)}
                    onRetryImage={(turnId) => activeSessionId && void admitImageTurn(activeSessionId, turnId)}
                    onRetryLoad={() => activeSessionId && void refreshTimeline(activeSessionId, true)}
                    onInspiration={(prompt) => { setDraft(prompt); setExplicitImageToolEnabled(true); document.getElementById('creation-prompt')?.focus(); }}
                    optimisticImages={tail ? activeRuntime?.optimisticImages ?? [] : []}
                    streamingText={tail ? activeRuntime?.streamingText ?? '' : ''}
                  />
                );
              }}
            />
          </div>
          {!commerceActive && !(commerceLaunch?.sessionId === activeSessionId && commerceMode?.sessionId !== activeSessionId) && <div className={styles.composerDock}>
            {showScrollToBottom && <Button aria-label="回到底部" className={styles.scrollToBottom} icon={<ArrowDown size={17} />} onClick={() => scrollToBottom('smooth')} shape="circle" />}
            <UnifiedComposer
              activePopover={activePopover}
              aspectRatio={aspectRatio}
              busy={activeBusy}
              capabilities={capabilities}
              count={count}
              disabled={composerDisabled}
              draft={draft}
              health={health}
              imageCreationEnabled={imageCreationEnabled}
              onAspectRatioChange={setAspectRatio}
              onChatModelSelect={setSelectedChatModel}
              onCountChange={setCount}
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
      </main>
      <Drawer className="workspaceDrawer" onClose={() => setSessionDrawerOpen(false)} open={sessionDrawerOpen} placement="left" size={320} title={zhCN.workspace.sessions}>{sidebar}</Drawer>
      <Drawer className="workspaceDrawer" onClose={() => setConfigDrawerOpen(false)} open={configDrawerOpen} placement="right" size={420} title={zhCN.workspace.generationConfig}>{mobileConfig}</Drawer>
    </div>
    </>
  );
}
