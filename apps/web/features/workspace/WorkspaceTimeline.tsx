import type { GenerationBatch, RecreateScope, TimelineItem } from '@zimage/domain';
import { Alert, Button, Image as AntdImage, Spin, Tag } from 'antd';
import { Bot, Download, ImageOff, RefreshCw, UserRound } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { BrandMark } from '@/features/brand/BrandMark';
import { zhCN } from '@/i18n';

import { HomeCommerceCarousel } from './HomeCommerceCarousel';
import { AssistantMessageContent } from './AssistantMessageContent';
import styles from './workspace.module.css';
import { nextPollingDelay } from './bounded-polling';

const statusLabels: Record<GenerationBatch['status'], string> = {
  ...zhCN.timeline.status,
};

interface WorkspaceTimelineProps {
  resolveAssetUrl?: (id: string, refresh?: boolean) => Promise<string | undefined>;
  onRefreshBatch?: (batch: GenerationBatch) => void;
  awaitingFirstDelta?: boolean;
  isChatStreaming?: boolean;
  items: TimelineItem[];
  loadError?: string;
  loading?: boolean;
  optimisticImages?: OptimisticImageTurnView[];
  streamingText: string;
  onDownloadBatch: (batch: GenerationBatch) => void;
  onRecreate: (batch: GenerationBatch, scope: RecreateScope, generationId?: string) => void;
  onRetryImage?: (turnId: string) => void;
  chatRecoveryActions?: Record<string, { label: string }>;
  chatRecoveryDisabled?: boolean;
  onRecoverChat?: (errorId: string) => void;
  onRetryLoad?: () => void;
  onInspiration?: (prompt: string) => void;
}

export function VisibleAsset({ id, initialUrl, alt, resolveAssetUrl }: {
  id: string; initialUrl?: string; alt: string;
  resolveAssetUrl?: (id: string, refresh?: boolean) => Promise<string | undefined>;
}) {
  const element = useRef<HTMLDivElement>(null);
  const scope = useMemo(() => ({ id, resolveAssetUrl }), [id, resolveAssetUrl]);
  const [intersection, setIntersection] = useState<{ scope: typeof scope; visible: boolean }>();
  const visible = intersection?.scope === scope && intersection.visible;
  const [tabVisible, setTabVisible] = useState(() => typeof document === 'undefined' || document.visibilityState !== 'hidden');
  const [result, setResult] = useState<{
    scope: typeof scope; url?: string; error?: boolean; version: number;
    request?: 'check' | 'refresh'; replaceInitial?: boolean;
  }>({ scope, version: 0 });
  const current = result.scope === scope ? result : { scope, version: 0 };
  const renderedUrl = current.url ?? (current.replaceInitial ? undefined : initialUrl);
  const automaticRefreshScope = useRef<typeof scope | undefined>(undefined);
  const pending = useRef<{ scope: typeof scope; refresh: boolean; promise: Promise<string | undefined> } | undefined>(undefined);
  useEffect(() => {
    const change = () => setTabVisible(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', change);
    return () => document.removeEventListener('visibilitychange', change);
  }, []);
  useEffect(() => {
    if (!resolveAssetUrl) return;
    if (typeof IntersectionObserver === 'undefined') {
      const timer = window.setTimeout(() => setIntersection({ scope, visible: true }), 0);
      return () => window.clearTimeout(timer);
    }
    // The empty inner div has zero height until an image mounts. Observe the
    // reserved frame so its visible lower half can trigger signing as well.
    const frame = element.current?.parentElement;
    let active = true;
    const observer = new IntersectionObserver(entries => {
      if (active) setIntersection({ scope, visible: entries.some(entry => entry.isIntersecting) });
    });
    if (frame) observer.observe(frame);
    return () => { active = false; observer.disconnect(); };
  }, [scope, resolveAssetUrl]);
  useEffect(() => {
    if (!visible || !tabVisible || !resolveAssetUrl || current.error || (renderedUrl && !current.request)) return;
    let cancelled = false;
    const refresh = current.request === 'refresh';
    let request = pending.current;
    if (!request || request.scope !== scope || request.refresh !== refresh) {
      const next = { scope, refresh, promise: resolveAssetUrl(id, refresh) };
      next.promise = next.promise.finally(() => { if (pending.current === next) pending.current = undefined; });
      request = next;
      pending.current = next;
    }
    void request.promise.then(url => {
      if (!cancelled) setResult({ scope, version: current.version, url, error: !url, replaceInitial: true });
    }).catch(() => {
      if (!cancelled) setResult({ scope, version: current.version, url: current.request === 'check' ? renderedUrl : undefined,
        error: current.request !== 'check', replaceInitial: true });
    });
    return () => { cancelled = true; };
  }, [scope, id, visible, tabVisible, renderedUrl, resolveAssetUrl, current.error, current.request, current.version]);
  const requestPreview = (refresh: boolean, automatic = false) => {
    if (!resolveAssetUrl) return;
    if (automatic && automaticRefreshScope.current === scope) {
      setResult({ scope, version: current.version, error: true, replaceInitial: true });
      return;
    }
    if (automatic) automaticRefreshScope.current = scope;
    setResult(previous => ({ scope, version: previous.scope === scope ? previous.version + 1 : 1,
      url: refresh ? undefined : renderedUrl, request: refresh ? 'refresh' : 'check', replaceInitial: true }));
  };
  return <div ref={element} className={styles.assetPreview}>{renderedUrl ? <AntdImage alt={alt} className={styles.assetPreview}
    preview={{ mask: false }} rootClassName={styles.assetPreview} src={renderedUrl}
    onError={() => requestPreview(true, true)} onClick={() => requestPreview(false)} /> :
    <div className={styles.assetState} role={current.error ? 'alert' : 'status'}>
      <span>{current.error ? '图片预览暂时不可用。' : '正在加载图片预览…'}</span>
      {current.error && resolveAssetUrl && <Button size="small" onClick={() => requestPreview(true)}>重试图片预览</Button>}
    </div>}</div>;
}

export interface OptimisticImageTurnView {
  batch: GenerationBatch;
  id: string;
  submitting: boolean;
}

function GenerationCard({
  batch,
  resolveAssetUrl,
  onRefreshBatch,
  onDownloadBatch,
  onRecreate,
  optimistic,
  onRetryImage,
}: {
  batch: GenerationBatch;
  resolveAssetUrl?: (id: string, refresh?: boolean) => Promise<string | undefined>;
  onRefreshBatch?: (batch: GenerationBatch) => void;
  onDownloadBatch: (batch: GenerationBatch) => void;
  onRecreate: (batch: GenerationBatch, scope: RecreateScope, generationId?: string) => void;
  optimistic?: boolean;
  onRetryImage?: () => void;
}) {
  const completed = batch.assets.filter((asset) => asset.status === 'succeeded' && !asset.expired);
  const failed = batch.assets.filter((asset) => asset.status === 'failed' && asset.error?.code !== 'CONFLICT');
  const working = batch.status === 'pending' || batch.status === 'processing';
  const needsReview = batch.assets.some(asset => asset.error?.code === 'CONFLICT');
  const [hourExpired, setHourExpired] = useState(() => nextPollingDelay(batch.createdAt, 'generation') === null);
  useEffect(() => {
    const remaining = Date.parse(batch.createdAt) + 3_600_000 - Date.now();
    const timer = window.setTimeout(() => setHourExpired(true), Math.max(0, remaining));
    return () => window.clearTimeout(timer);
  }, [batch.createdAt]);
  return (
    <div className={styles.generationCard} data-status={batch.status}>
      <header className={styles.generationHeader}>
        <span className={styles.generationStatusTitle}>
          {needsReview ? '待核对' : working ? '正在创作' : batch.status === 'failed' ? '生成失败' : '图片结果'}
        </span>
        <Tag color={needsReview || batch.status === 'partial' ? 'warning' : batch.status === 'failed' ? 'error' : batch.status === 'succeeded' ? 'success' : 'processing'}>
          {needsReview ? '待核对' : statusLabels[batch.status]}
        </Tag>
      </header>
      <div className={styles.generationMeta}>
        {batch.provider} · {batch.model} · {batch.config.aspectRatio} · {batch.config.resolution}
      </div>
      <div className={styles.assetGrid}>
        {batch.assets.map((asset, index) => (
          <div
            className={styles.asset}
            key={asset.id}
            style={{ aspectRatio: batch.config.aspectRatio.replace(':', ' / ') }}
          >
            {asset.status === 'succeeded' && !asset.expired ? (
              <VisibleAsset id={asset.id} initialUrl={asset.url} alt={`生成结果 ${index + 1}`} resolveAssetUrl={resolveAssetUrl} />
            ) : null}
            {asset.status === 'pending' && (
              <div className={`${styles.assetState} ${styles.assetSkeleton}`}><span>{zhCN.timeline.state.pending}</span></div>
            )}
            {asset.error?.code === 'CONFLICT' && asset.status !== 'failed' && <div className={styles.assetState}><ImageOff size={23}/><span>{asset.error.message}</span></div>}
            {asset.status === 'processing' && asset.error?.code !== 'CONFLICT' && (
              <div className={`${styles.assetState} ${styles.assetSkeleton}`}><Spin size="small" /><span>{zhCN.timeline.state.processing}</span></div>
            )}
            {asset.status === 'failed' && (
              <div className={styles.assetState}><ImageOff size={23} /><span>{asset.error?.message}</span></div>
            )}
            {asset.expired && (
              <div className={`${styles.assetState} ${styles.expired}`}>
                <span>{zhCN.timeline.expired}</span>
              </div>
            )}
            {!optimistic && asset.error?.code !== 'CONFLICT' && (asset.status === 'succeeded' || asset.status === 'failed') && (
              <Button
                aria-label={`重新生成第 ${index + 1} 张`}
                className={styles.assetRecreate}
                icon={<RefreshCw size={13} />}
                onClick={() => onRecreate(batch, 'single', asset.id)}
                size="small"
              />
            )}
          </div>
        ))}
      </div>
      <footer className={styles.generationFooter}>
        <span className={styles.muted}>{batch.source === 'chat_tool' ? zhCN.timeline.sourceChatTool : zhCN.timeline.directSource}</span>
        <div className={styles.actionGroup}>
          {completed.length > 0 && (
            <Button icon={<Download size={14} />} onClick={() => onDownloadBatch(batch)} size="small">{zhCN.timeline.batchDownload}</Button>
          )}
          {working && hourExpired && onRefreshBatch && <Button onClick={() => onRefreshBatch(batch)} size="small">手动刷新进度</Button>}
          {optimistic && batch.status === 'failed' && batch.assets.some(asset=>asset.error?.retryable) && onRetryImage && (
            <Button icon={<RefreshCw size={14} />} onClick={onRetryImage}>重试生成</Button>
          )}
          {!optimistic && failed.length > 0 && (
            <Button icon={<RefreshCw size={14} />} onClick={() => onRecreate(batch, 'failed')} size="small">{zhCN.timeline.recreateFailed}</Button>
          )}
          {batch.assets.some((asset) => asset.expired) && !batch.assets.some(asset=>asset.error?.code==='CONFLICT') && (
            <Button icon={<RefreshCw size={14} />} onClick={() => onRecreate(batch, 'all')} size="small" type="primary">{zhCN.timeline.recreateAll}</Button>
          )}
        </div>
      </footer>
    </div>
  );
}

function GenerationTurn({
  batch,
  resolveAssetUrl,
  onRefreshBatch,
  onDownloadBatch,
  onRecreate,
  optimistic = false,
  onRetryImage,
}: {
  batch: GenerationBatch;
  resolveAssetUrl?: (id: string, refresh?: boolean) => Promise<string | undefined>;
  onRefreshBatch?: (batch: GenerationBatch) => void;
  onDownloadBatch: (batch: GenerationBatch) => void;
  onRecreate: (batch: GenerationBatch, scope: RecreateScope, generationId?: string) => void;
  optimistic?: boolean;
  onRetryImage?: () => void;
}) {
  const working = batch.status === 'pending' || batch.status === 'processing';
  const needsReview = batch.assets.some(asset => asset.error?.code === 'CONFLICT');
  return (
    <div className={styles.generationTurn} data-testid={optimistic ? 'optimistic-image-turn' : undefined}>
      {batch.source === 'direct' && (
        <article className={`${styles.message} ${styles.messageUser}`} data-testid="direct-generation-prompt">
          <div className={styles.avatar}><UserRound size={15} /></div>
          <div className={styles.bubble}>{batch.prompt}</div>
        </article>
      )}
      <article aria-busy={working && !needsReview} aria-label="图片生成结果" className={`${styles.message} ${styles.generationResponse}`}>
        <div className={styles.avatar}><Bot size={16} /></div>
        <GenerationCard
          batch={batch}
          resolveAssetUrl={resolveAssetUrl}
          onRefreshBatch={onRefreshBatch}
          onDownloadBatch={onDownloadBatch}
          onRecreate={onRecreate}
          onRetryImage={onRetryImage}
          optimistic={optimistic}
        />
      </article>
    </div>
  );
}

export function WorkspaceTimeline({
  resolveAssetUrl,
  onRefreshBatch,
  awaitingFirstDelta = false,
  isChatStreaming = false,
  items,
  loadError,
  loading = false,
  optimisticImages = [],
  streamingText,
  onDownloadBatch,
  onRecreate,
  onRetryImage,
  onRetryLoad,
  chatRecoveryActions = {},
  chatRecoveryDisabled = false,
  onRecoverChat,
}: WorkspaceTimelineProps) {
  if (loading) {
    return (
      <div aria-label="正在加载会话" className={styles.timelineLoading} data-testid="timeline-loading" role="status">
        <div className={styles.timelineSkeletonUser} />
        <div className={styles.timelineSkeletonAssistant} />
        <div className={styles.timelineSkeletonAssistantShort} />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className={styles.timelineLoadError}>
        <Alert
          action={onRetryLoad ? <Button onClick={onRetryLoad}>重试加载</Button> : undefined}
          description={loadError}
          showIcon
          title="会话加载失败"
          type="error"
        />
      </div>
    );
  }

  if (items.length === 0 && optimisticImages.length === 0 && !streamingText && !awaitingFirstDelta) {
    return (
      <div className={styles.empty}>
        <div className={styles.heroHeading}><span className={styles.heroMark} aria-hidden="true"><BrandMark/></span><h1 className={styles.heroTitle}>你好，想创作什么？</h1></div>
        <HomeCommerceCarousel />
      </div>
    );
  }

  return (
    <div className={styles.timeline}>
      {items.map((item) => {
        if (item.type === 'message') {
          return (
            <article className={`${styles.message} ${item.role === 'user' ? styles.messageUser : ''}`} key={item.id}>
              <div className={styles.avatar}>{item.role === 'user' ? <UserRound size={15} /> : <Bot size={16} />}</div>
              <div className={`${styles.bubble} ${item.role === 'assistant' ? styles.assistantBubble : ''}`}>
                {item.role === 'assistant' ? <AssistantMessageContent content={item.content} /> : item.content}
              </div>
            </article>
          );
        }
        if (item.type === 'generation') {
          return <GenerationTurn batch={item.batch} key={item.id} resolveAssetUrl={resolveAssetUrl} onRefreshBatch={onRefreshBatch} onDownloadBatch={onDownloadBatch} onRecreate={onRecreate} />;
        }
        const recovery = chatRecoveryActions[item.id];
        return <Alert action={recovery && onRecoverChat ? <Button disabled={chatRecoveryDisabled} onClick={() => onRecoverChat(item.id)} size="small">{recovery.label}</Button> : undefined} description={item.error.message} key={item.id} showIcon type="error" />;
      })}
      {optimisticImages.map((turn) => (
        <GenerationTurn
          batch={turn.batch}
          resolveAssetUrl={resolveAssetUrl}
          onRefreshBatch={onRefreshBatch}
          key={turn.id}
          onDownloadBatch={onDownloadBatch}
          onRecreate={onRecreate}
          onRetryImage={onRetryImage ? () => onRetryImage(turn.id) : undefined}
          optimistic
        />
      ))}
      {(streamingText || awaitingFirstDelta) && (
        <article className={styles.message}>
          <div className={styles.avatar}><Bot size={16} /></div>
          {streamingText ? (
            <div className={`${styles.bubble} ${styles.assistantBubble}`}>
              <AssistantMessageContent content={streamingText} streaming={isChatStreaming} />
            </div>
          ) : (
            <div className={`${styles.bubble} ${styles.bubbleLoading}`}>
              <span
                aria-label={zhCN.timeline.thinking}
                className={styles.typingIndicator}
                data-testid="chat-typing-indicator"
                role="status"
              >
                <span className={styles.typingDot} />
                <span className={styles.typingDot} />
                <span className={styles.typingDot} />
              </span>
            </div>
          )}
        </article>
      )}
    </div>
  );
}
