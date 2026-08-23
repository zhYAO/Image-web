'use client';

import {
  MAX_UPLOAD_BYTES,
  resolveImageToolEnabled,
  sanitizeError,
  type AspectRatio,
  type GenerationBatch,
  type ImageResolution,
  type ProviderCapability,
  type ProviderHealth,
  type Quota,
  type SafeError,
  type Session,
  type Skill,
  type TimelineItem,
  type UploadReference,
  type WorkspaceGateway,
} from '@zimage/domain';
import { Alert, Button, Drawer, Input, Select, Space } from 'antd';
import { Archive, ChevronRight, Menu } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { getWorkspaceGateway } from '@/gateways';
import { MockWorkspaceGateway } from '@/gateways/mock-workspace-gateway';
import { useWorkspaceStore } from '@/store/workspace-store';

import { findModelCapability, normalizeGenerationSelection } from './GenerationConfig';
import { SessionSidebar } from './SessionSidebar';
import { UnifiedComposer } from './UnifiedComposer';
import { WorkspaceTimeline } from './WorkspaceTimeline';
import styles from './workspace.module.css';

interface UnifiedWorkspaceProps {
  gateway?: WorkspaceGateway;
}

const MAX_REFERENCES = 4;
const ALLOWED_REFERENCE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export function UnifiedWorkspace({ gateway: providedGateway }: UnifiedWorkspaceProps) {
  const gateway = useMemo(() => providedGateway ?? getWorkspaceGateway(), [providedGateway]);
  const {
    activePopover,
    configDrawerOpen,
    drafts,
    explicitImageToolEnabled,
    mode,
    scenario,
    selectedSkillId,
    sidebarCollapsed,
    sessionDrawerOpen,
    skillValues,
    selectSkill,
    setActivePopover,
    setConfigDrawerOpen,
    setDraft,
    setExplicitImageToolEnabled,
    setMode,
    setScenario,
    setSessionDrawerOpen,
    setSidebarCollapsed,
    setSkillValue,
  } = useWorkspaceStore();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string>();
  const [timeline, setTimeline] = useState<TimelineItem[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [quota, setQuota] = useState<Quota>();
  const [capabilities, setCapabilities] = useState<ProviderCapability[]>([]);
  const [health, setHealth] = useState<ProviderHealth[]>([]);
  const [busy, setBusy] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [feedback, setFeedback] = useState<{ error?: SafeError; message: string; retrySessionId?: string }>();
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>('1:1');
  const [resolution, setResolution] = useState<ImageResolution>('2K');
  const [count, setCount] = useState(2);
  const [selectedProvider, setSelectedProvider] = useState<string>();
  const [selectedModelId, setSelectedModelId] = useState<string>();
  const [focusSkillFieldKey, setFocusSkillFieldKey] = useState<string>();
  const [references, setReferences] = useState<UploadReference[]>([]);
  const localPreviewUrls = useRef(new Set<string>());

  const selectedSkill = skills.find((skill) => skill.id === selectedSkillId);
  const chatImageToolEnabled = resolveImageToolEnabled({
    explicitEnabled: explicitImageToolEnabled,
    skillRequiresImage: selectedSkill?.requiresImageTool ?? false,
  });
  const displayedImageToolEnabled = mode === 'image' || chatImageToolEnabled;
  const selectedModel = findModelCapability(capabilities, selectedProvider, selectedModelId)?.model;

  const changeScenario = (value: typeof scenario) => {
    setScenario(value);
    if (gateway instanceof MockWorkspaceGateway) gateway.setScenario(value);
  };

  const refreshSessions = useCallback(async () => {
    const next = await gateway.listSessions();
    setSessions(next);
    return next;
  }, [gateway]);

  const refreshTimeline = useCallback(
    async (sessionId?: string) => {
      if (!sessionId) {
        setTimeline([]);
        return;
      }
      try {
        setTimeline(await gateway.getTimeline(sessionId));
      } catch (error: unknown) {
        if (sanitizeError(error).code === 'SESSION_NOT_FOUND') setTimeline([]);
        else throw error;
      }
    },
    [gateway],
  );

  useEffect(() => {
    let cancelled = false;
    const initialize = async () => {
      const [nextSessions, nextSkills, nextQuota, nextCapabilities, nextHealth] = await Promise.all([
        gateway.listSessions(),
        gateway.getSkills(),
        gateway.getQuota(),
        gateway.getProviderCapabilities(),
        gateway.getProviderHealth(),
      ]);
      if (cancelled) return;
      setSessions(nextSessions);
      setSkills(nextSkills);
      setQuota(nextQuota);
      setCapabilities(nextCapabilities);
      setHealth(nextHealth);
      const initialSelection = normalizeGenerationSelection(nextCapabilities, {
        aspectRatio: '1:1',
        count: 2,
        resolution: '2K',
      });
      setAspectRatio(initialSelection.aspectRatio);
      setCount(initialSelection.count);
      setResolution(initialSelection.resolution);
      setSelectedProvider(initialSelection.provider);
      setSelectedModelId(initialSelection.model);
      const initialId = nextSessions[0]?.id;
      setActiveSessionId(initialId);
      if (initialId) setTimeline(await gateway.getTimeline(initialId));
      if (gateway instanceof MockWorkspaceGateway) {
        const recoveryNotice = gateway.getRecoveryNotice();
        if (recoveryNotice) setFeedback({ message: recoveryNotice });
      }
    };
    void initialize().catch((error: unknown) => {
      if (!cancelled) setFeedback({ error: sanitizeError(error), message: sanitizeError(error).message });
    });
    return () => {
      cancelled = true;
    };
  }, [gateway]);

  useEffect(
    () => () => {
      for (const previewUrl of localPreviewUrls.current) URL.revokeObjectURL(previewUrl);
      localPreviewUrls.current.clear();
    },
    [],
  );

  useEffect(() => {
    const hasActiveBatch = timeline.some(
      (item) => item.type === 'generation' && ['pending', 'processing'].includes(item.batch.status),
    );
    if (!hasActiveBatch || !activeSessionId) return;
    const timer = window.setInterval(() => void refreshTimeline(activeSessionId), 300);
    return () => window.clearInterval(timer);
  }, [activeSessionId, refreshTimeline, timeline]);

  const createSession = async () => {
    const session = await gateway.createSession();
    setActiveSessionId(session.id);
    setTimeline([]);
    await refreshSessions();
    setSessionDrawerOpen(false);
  };

  const ensureSession = async () => {
    if (activeSessionId) return activeSessionId;
    const session = await gateway.createSession();
    setActiveSessionId(session.id);
    await refreshSessions();
    return session.id;
  };

  const submit = async () => {
    const prompt = drafts[mode].trim();
    if (!prompt || busy) return;
    const missingField = selectedSkill?.fields.find(
      (field) => field.required && !skillValues[field.key]?.trim(),
    );
    if (missingField) {
      setFeedback({
        error: { code: 'VALIDATION_PROMPT_REQUIRED', message: `请填写必填技能参数：${missingField.label}`, retryable: false },
        message: `请填写必填技能参数：${missingField.label}`,
      });
      setFocusSkillFieldKey(missingField.key);
      setActivePopover('skill');
      if (window.matchMedia('(max-width: 767px)').matches) setConfigDrawerOpen(true);
      return;
    }

    setBusy(true);
    setFeedback(undefined);
    try {
      if (mode === 'image') {
        const sessionId = await ensureSession();
        await gateway.submitImage({
          aspectRatio,
          count,
          model: selectedModelId,
          prompt,
          provider: selectedProvider,
          references: references.map((reference) => ({
            mimeType: reference.mimeType,
            name: reference.name,
            size: reference.size,
            status: reference.status,
          })),
          resolution,
          scenario,
          sessionId,
          skillId: selectedSkillId,
          skillValues,
        });
        setDraft('image', '');
        await Promise.all([refreshTimeline(sessionId), refreshSessions()]);
      } else {
        const existingSessionId = activeSessionId;
        const optimisticSessionId = existingSessionId ?? 'pending-session';
        setTimeline((items) => [
          ...items,
          {
            content: prompt,
            createdAt: new Date().toISOString(),
            id: `optimistic-${Date.now()}`,
            role: 'user',
            sequence: items.length + 1,
            sessionId: optimisticSessionId,
            type: 'message',
          },
        ]);
        let resolvedSessionId = existingSessionId;
        for await (const event of gateway.streamChat({
          imageToolEnabled: chatImageToolEnabled,
          message: prompt,
          scenario,
          sessionId: existingSessionId,
          skillId: selectedSkillId,
          skillValues,
        })) {
          if (event.type === 'session.created') {
            resolvedSessionId = event.session.id;
            setActiveSessionId(event.session.id);
          } else if (event.type === 'message.delta') {
            setStreamingText((value) => value + event.delta);
          } else if (event.type === 'stream.failed') {
            setFeedback({ error: event.error, message: event.error.message });
          }
        }
        setDraft('chat', '');
        setStreamingText('');
        await Promise.all([refreshTimeline(resolvedSessionId), refreshSessions()]);
      }
    } catch (error: unknown) {
      const safe = sanitizeError(error);
      setFeedback({ error: safe, message: safe.message });
    } finally {
      setBusy(false);
    }
  };

  const deleteSession = async (sessionId: string) => {
    try {
      await gateway.deleteSession(sessionId);
      setFeedback({ message: '会话已隐藏，后台清理已完成。' });
    } catch (error: unknown) {
      const safe = sanitizeError(error);
      setFeedback({ error: safe, message: safe.message, retrySessionId: safe.retryable ? sessionId : undefined });
    }
    const next = await refreshSessions();
    if (activeSessionId === sessionId) {
      const nextId = next[0]?.id;
      setActiveSessionId(nextId);
      await refreshTimeline(nextId);
    }
  };

  const renameSession = async (sessionId: string, title: string) => {
    await gateway.renameSession(sessionId, title);
    await refreshSessions();
  };

  const selectSession = (sessionId: string) => {
    setActiveSessionId(sessionId);
    void refreshTimeline(sessionId);
    setSessionDrawerOpen(false);
  };

  const recreate = async (batch: GenerationBatch, scope: 'failed' | 'all') => {
    try {
      await gateway.recreateGeneration({ batchId: batch.id, scope });
      await refreshTimeline(batch.sessionId);
    } catch (error: unknown) {
      const safe = sanitizeError(error);
      setFeedback({ error: safe, message: safe.message });
    }
  };

  const downloadBatch = (batch: GenerationBatch) => {
    batch.assets.forEach((asset, index) => {
      if (!asset.url || asset.expired || asset.status !== 'succeeded') return;
      const link = document.createElement('a');
      link.download = `zimage-${batch.id}-${index + 1}.svg`;
      link.href = asset.url;
      link.click();
    });
  };

  const addReferences = (files: FileList) => {
    const validFiles: File[] = [];
    let validationError: SafeError | undefined;

    for (const file of Array.from(files)) {
      if (!ALLOWED_REFERENCE_TYPES.has(file.type)) {
        validationError ??= {
          code: 'VALIDATION_UPLOAD_TYPE',
          message: `${file.name} 格式不支持，仅支持 JPG、PNG 或 WebP。`,
          retryable: false,
        };
      } else if (file.size > MAX_UPLOAD_BYTES) {
        validationError ??= {
          code: 'VALIDATION_UPLOAD_SIZE',
          message: `${file.name} 超过 10 MB。`,
          retryable: false,
        };
      } else {
        validFiles.push(file);
      }
    }

    const remaining = Math.max(0, MAX_REFERENCES - references.length);
    const acceptedFiles = validFiles.slice(0, remaining);
    if (validFiles.length > remaining) {
      validationError = {
        code: 'VALIDATION_IMAGE_COUNT',
        message: '最多可添加 4 张参考图。',
        retryable: false,
      };
    }

    const additions = acceptedFiles.map((file): UploadReference => {
      const previewUrl = URL.createObjectURL(file);
      localPreviewUrls.current.add(previewUrl);
      return {
        mimeType: file.type,
        name: file.name,
        previewUrl,
        size: file.size,
        status: 'ready',
      };
    });

    if (validationError) setFeedback({ error: validationError, message: validationError.message });
    setReferences((current) => [...current, ...additions]);
  };

  const removeReference = (index: number) => {
    setReferences((current) => {
      const reference = current[index];
      if (reference?.previewUrl && localPreviewUrls.current.delete(reference.previewUrl)) {
        URL.revokeObjectURL(reference.previewUrl);
      }
      return current.filter((_, itemIndex) => itemIndex !== index);
    });
  };

  const selectModel = (provider: string, model: string) => {
    const normalized = normalizeGenerationSelection(capabilities, {
      aspectRatio,
      count,
      model,
      provider,
      resolution,
    });
    setAspectRatio(normalized.aspectRatio);
    setCount(normalized.count);
    setResolution(normalized.resolution);
    setSelectedProvider(normalized.provider);
    setSelectedModelId(normalized.model);
  };

  const chooseSkill = (skillId: string) => {
    setFocusSkillFieldKey(undefined);
    selectSkill(skillId);
  };

  const sidebar = (
    <SessionSidebar
      activeSessionId={activeSessionId}
      onCreate={() => void createSession()}
      onDelete={(sessionId) => void deleteSession(sessionId)}
      onRename={(sessionId, title) => void renameSession(sessionId, title)}
      onSelect={selectSession}
      onCollapse={() => setSidebarCollapsed(true)}
      sessions={sessions}
    />
  );
  const activeSession = sessions.find((session) => session.id === activeSessionId);
  const mobileConfig = (
    <div className={styles.mobileConfig}>
      <label>
        <span className={styles.popoverLabel}>生成模型</span>
        <Select
          aria-label="移动端生成模型"
          onChange={(value) => {
            const [provider = '', model = ''] = value.split('::');
            selectModel(provider, model);
          }}
          options={capabilities.flatMap((capability) => capability.models.map((model) => ({
            label: `${capability.provider} · ${model.label}`,
            value: `${capability.provider}::${model.id}`,
          })))}
          value={selectedProvider && selectedModelId ? `${selectedProvider}::${selectedModelId}` : undefined}
        />
      </label>
      <div>
        <span className={styles.popoverLabel}>比例</span>
        <div className={styles.mobileOptionGrid}>
          {selectedModel?.aspectRatios.map((ratio) => (
            <Button key={ratio} onClick={() => setAspectRatio(ratio)} type={ratio === aspectRatio ? 'primary' : 'default'}>{ratio}</Button>
          ))}
        </div>
      </div>
      <div>
        <span className={styles.popoverLabel}>分辨率</span>
        <div className={styles.mobileOptionGrid}>
          {selectedModel?.resolutions.map((item) => (
            <Button key={item} onClick={() => setResolution(item)} type={item === resolution ? 'primary' : 'default'}>{item}</Button>
          ))}
        </div>
      </div>
      <div>
        <span className={styles.popoverLabel}>数量</span>
        <div className={styles.mobileOptionGrid}>
          {Array.from({ length: Math.min(selectedModel?.maxImages ?? 1, 4) }, (_, index) => index + 1).map((item) => (
            <Button key={item} onClick={() => setCount(item)} type={item === count ? 'primary' : 'default'}>{item}</Button>
          ))}
        </div>
      </div>
      {selectedSkill?.fields.map((field) => (
        <label key={field.key}>
          <span className={styles.popoverLabel}>{field.label}</span>
          <Input aria-label={field.label} onChange={(event) => setSkillValue(field.key, event.target.value)} value={skillValues[field.key] ?? ''} />
        </label>
      ))}
    </div>
  );

  return (
    <div className={`${styles.workspace} ${sidebarCollapsed ? styles.workspaceCollapsed : ''}`}>
      <aside className={styles.sidebar}>
        {sidebarCollapsed ? (
          <Button aria-label="展开会话侧栏" className={styles.expandSidebar} icon={<ChevronRight size={18} />} onClick={() => setSidebarCollapsed(false)} type="text" />
        ) : sidebar}
      </aside>
      <main className={styles.main}>
        <header className={styles.header}>
          <Space>
            <Button aria-label="打开会话" className={styles.mobileControl} icon={<Menu size={18} />} onClick={() => setSessionDrawerOpen(true)} type="text" />
            <span className={styles.headerTitle}>{activeSession?.title ?? '开启创作'}</span>
          </Space>
          <Space>
            <Select
              aria-label="Mock 场景"
              className={styles.devScenario}
              onChange={changeScenario}
              options={[
                { label: 'Mock · 正常', value: 'happy' },
                { label: 'Mock · 部分成功', value: 'partial' },
                { label: 'Mock · 服务不可用', value: 'provider-unavailable' },
                { label: 'Mock · 资源过期', value: 'expired' },
                { label: 'Mock · 删除重试', value: 'delete-retry' },
              ]}
              size="small"
              value={scenario}
            />
            <Button
              aria-label="资产库"
              className={styles.assetLibraryButton}
              icon={<Archive size={16} />}
              onClick={() => setFeedback({ message: '资产库暂未开放' })}
            >
              资产库
            </Button>
          </Space>
        </header>
        {feedback && (
          <div className={styles.statusFeedback}>
            <Alert
              action={feedback.retrySessionId ? <Button onClick={() => void deleteSession(feedback.retrySessionId!)} size="small">重试清理</Button> : undefined}
              closable
              title={feedback.message}
              onClose={() => setFeedback(undefined)}
              role="alert"
              showIcon
              type={feedback.error ? 'error' : 'info'}
            />
          </div>
        )}
        <div className={styles.timelineScroll}>
          <WorkspaceTimeline
            items={timeline}
            onDownloadBatch={downloadBatch}
            onRecreate={(batch, scope) => void recreate(batch, scope)}
            onSelectSkill={chooseSkill}
            skills={skills}
            streamingText={streamingText}
          />
        </div>
        <div className={styles.composerDock}>
          <UnifiedComposer
            activePopover={activePopover}
            aspectRatio={aspectRatio}
            busy={busy}
            capabilities={capabilities}
            count={count}
            draft={drafts[mode]}
            focusSkillFieldKey={focusSkillFieldKey}
            health={health}
            imageToolEnabled={displayedImageToolEnabled}
            mode={mode}
            onAspectRatioChange={setAspectRatio}
            onClearSkill={() => {
              setActivePopover(undefined);
              selectSkill(undefined);
            }}
            onCountChange={setCount}
            onDraftChange={(value) => setDraft(mode, value)}
            onImageToolChange={setExplicitImageToolEnabled}
            onModeChange={(nextMode) => {
              setActivePopover(undefined);
              setMode(nextMode);
            }}
            onModelSelect={selectModel}
            onOpenConfig={() => setConfigDrawerOpen(true)}
            onPopoverChange={setActivePopover}
            onReferenceAdd={addReferences}
            onReferenceRemove={removeReference}
            onResolutionChange={setResolution}
            onSkillValueChange={setSkillValue}
            onSubmit={() => void submit()}
            quota={quota}
            references={references}
            resolution={resolution}
            selectedModel={selectedModel}
            selectedProvider={selectedProvider}
            selectedSkill={selectedSkill}
            skillValues={skillValues}
          />
        </div>
      </main>
      <Drawer className="workspaceDrawer" onClose={() => setSessionDrawerOpen(false)} open={sessionDrawerOpen} placement="left" size={320} title="会话">
        {sidebar}
      </Drawer>
      <Drawer className="workspaceDrawer" onClose={() => setConfigDrawerOpen(false)} open={configDrawerOpen} placement="right" size={420} title="生成配置">
        {mobileConfig}
      </Drawer>
    </div>
  );
}
