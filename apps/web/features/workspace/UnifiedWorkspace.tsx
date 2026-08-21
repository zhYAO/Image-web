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
import { Alert, Button, Drawer, Space } from 'antd';
import { Menu, SlidersHorizontal } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { getWorkspaceGateway } from '@/gateways';
import { MockWorkspaceGateway } from '@/gateways/mock-workspace-gateway';
import { useWorkspaceStore } from '@/store/workspace-store';

import { GenerationConfig } from './GenerationConfig';
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
    configDrawerOpen,
    drafts,
    explicitImageToolEnabled,
    mode,
    scenario,
    selectedSkillId,
    sessionDrawerOpen,
    skillValues,
    selectSkill,
    setConfigDrawerOpen,
    setDraft,
    setExplicitImageToolEnabled,
    setMode,
    setScenario,
    setSessionDrawerOpen,
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
  const [resolution, setResolution] = useState<ImageResolution>('1K');
  const [count, setCount] = useState(2);
  const [references, setReferences] = useState<UploadReference[]>([]);
  const localPreviewUrls = useRef(new Set<string>());

  const selectedSkill = skills.find((skill) => skill.id === selectedSkillId);
  const chatImageToolEnabled = resolveImageToolEnabled({
    explicitEnabled: explicitImageToolEnabled,
    skillRequiresImage: selectedSkill?.requiresImageTool ?? false,
  });
  const displayedImageToolEnabled = mode === 'image' || chatImageToolEnabled;

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
      if (window.matchMedia('(max-width: 1199px)').matches) setConfigDrawerOpen(true);
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
          model: capabilities[0]?.models[0]?.id,
          prompt,
          provider: capabilities[0]?.provider,
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

  const config = (
    <GenerationConfig
      aspectRatio={aspectRatio}
      count={count}
      health={health[0]}
      mode={mode}
      onAspectRatioChange={setAspectRatio}
      onCountChange={setCount}
      onReferenceAdd={addReferences}
      onReferenceRemove={removeReference}
      onResolutionChange={setResolution}
      onScenarioChange={changeScenario}
      onSkillValueChange={setSkillValue}
      prompt={drafts[mode]}
      providerCapabilities={capabilities}
      quota={quota}
      references={references}
      resolution={resolution}
      scenario={scenario}
      selectedSkill={selectedSkill}
      skillValues={skillValues}
    />
  );

  const sidebar = (
    <SessionSidebar
      activeSessionId={activeSessionId}
      onCreate={() => void createSession()}
      onDelete={(sessionId) => void deleteSession(sessionId)}
      onRename={(sessionId, title) => void renameSession(sessionId, title)}
      onSelect={selectSession}
      sessions={sessions}
    />
  );
  const activeSession = sessions.find((session) => session.id === activeSessionId);

  return (
    <div className={styles.workspace}>
      <aside className={styles.sidebar}>{sidebar}</aside>
      <main className={styles.main}>
        <header className={styles.header}>
          <Space>
            <Button aria-label="打开会话" className={styles.mobileControl} icon={<Menu size={18} />} onClick={() => setSessionDrawerOpen(true)} type="text" />
            <span className={styles.headerTitle}>{activeSession?.title ?? '新的创作'}</span>
          </Space>
          <Space>
            <span className={styles.muted}>Phase 1A · Mock</span>
            <Button aria-label="打开生成配置" className={styles.mobileControl} icon={<SlidersHorizontal size={18} />} onClick={() => setConfigDrawerOpen(true)} type="text" />
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
            onSelectSkill={(skillId) => selectSkill(skillId)}
            skills={skills}
            streamingText={streamingText}
          />
        </div>
        <div className={styles.composerDock}>
          <UnifiedComposer
            busy={busy}
            draft={drafts[mode]}
            imageToolEnabled={displayedImageToolEnabled}
            mode={mode}
            onClearSkill={() => selectSkill(undefined)}
            onDraftChange={(value) => setDraft(mode, value)}
            onImageToolChange={setExplicitImageToolEnabled}
            onModeChange={setMode}
            onOpenConfig={() => setConfigDrawerOpen(true)}
            onReferenceAdd={addReferences}
            onReferenceRemove={removeReference}
            onSubmit={() => void submit()}
            references={references}
            selectedSkill={selectedSkill}
          />
        </div>
      </main>
      <aside className={styles.configPanel}>{config}</aside>
      <Drawer className="workspaceDrawer" onClose={() => setSessionDrawerOpen(false)} open={sessionDrawerOpen} placement="left" size={320} title="会话">
        {sidebar}
      </Drawer>
      <Drawer className="workspaceDrawer" onClose={() => setConfigDrawerOpen(false)} open={configDrawerOpen} placement="right" size={420} title="生成配置">
        {config}
      </Drawer>
    </div>
  );
}
