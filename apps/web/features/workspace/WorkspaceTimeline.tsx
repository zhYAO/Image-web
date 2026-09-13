import type { GenerationBatch, RecreateScope, TimelineItem } from '@zimage/domain';
import { Alert, Button, Image as AntdImage, Spin, Tag } from 'antd';
import { ArrowRight, ArrowUpRight, Bot, Download, ImageOff, Mountain, RefreshCw, ShoppingBag, Sparkles, Sun, UserRound } from 'lucide-react';

import { zhCN } from '@/i18n';

import { AssistantMessageContent } from './AssistantMessageContent';
import styles from './workspace.module.css';

const statusLabels: Record<GenerationBatch['status'], string> = {
  ...zhCN.timeline.status,
};

interface WorkspaceTimelineProps {
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

export interface OptimisticImageTurnView {
  batch: GenerationBatch;
  id: string;
  submitting: boolean;
}

function GenerationCard({
  batch,
  onDownloadBatch,
  onRecreate,
  optimistic,
  onRetryImage,
}: {
  batch: GenerationBatch;
  onDownloadBatch: (batch: GenerationBatch) => void;
  onRecreate: (batch: GenerationBatch, scope: RecreateScope, generationId?: string) => void;
  optimistic?: boolean;
  onRetryImage?: () => void;
}) {
  const completed = batch.assets.filter((asset) => asset.status === 'succeeded' && !asset.expired);
  const failed = batch.assets.filter((asset) => asset.status === 'failed');
  const working = batch.status === 'pending' || batch.status === 'processing';
  return (
    <div className={styles.generationCard} data-status={batch.status}>
      <header className={styles.generationHeader}>
        <span className={styles.generationStatusTitle}>
          {working ? '正在创作' : batch.status === 'failed' ? '生成失败' : '图片结果'}
        </span>
        <Tag color={batch.status === 'failed' ? 'red' : batch.status === 'partial' ? 'orange' : 'purple'}>
          {statusLabels[batch.status]}
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
            {asset.status === 'succeeded' && asset.url ? (
              <AntdImage
                alt={`生成结果 ${index + 1}`}
                className={styles.assetPreview}
                preview={{ mask: false }}
                rootClassName={styles.assetPreview}
                src={asset.url}
              />
            ) : null}
            {asset.status === 'pending' && (
              <div className={`${styles.assetState} ${styles.assetSkeleton}`}><span>{zhCN.timeline.state.pending}</span></div>
            )}
            {asset.status === 'processing' && (
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
            {!optimistic && (asset.status === 'succeeded' || asset.status === 'failed') && (
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
          {optimistic && batch.status === 'failed' && onRetryImage && (
            <Button icon={<RefreshCw size={14} />} onClick={onRetryImage}>重试生成</Button>
          )}
          {!optimistic && failed.length > 0 && (
            <Button icon={<RefreshCw size={14} />} onClick={() => onRecreate(batch, 'failed')} size="small">{zhCN.timeline.recreateFailed}</Button>
          )}
          {batch.assets.some((asset) => asset.expired) && (
            <Button icon={<RefreshCw size={14} />} onClick={() => onRecreate(batch, 'all')} size="small" type="primary">{zhCN.timeline.recreateAll}</Button>
          )}
        </div>
      </footer>
    </div>
  );
}

function GenerationTurn({
  batch,
  onDownloadBatch,
  onRecreate,
  optimistic = false,
  onRetryImage,
}: {
  batch: GenerationBatch;
  onDownloadBatch: (batch: GenerationBatch) => void;
  onRecreate: (batch: GenerationBatch, scope: RecreateScope, generationId?: string) => void;
  optimistic?: boolean;
  onRetryImage?: () => void;
}) {
  const working = batch.status === 'pending' || batch.status === 'processing';
  return (
    <div className={styles.generationTurn} data-testid={optimistic ? 'optimistic-image-turn' : undefined}>
      {batch.source === 'direct' && (
        <article className={`${styles.message} ${styles.messageUser}`} data-testid="direct-generation-prompt">
          <div className={styles.avatar}><UserRound size={15} /></div>
          <div className={styles.bubble}>{batch.prompt}</div>
        </article>
      )}
      <article aria-busy={working} aria-label="图片生成结果" className={`${styles.message} ${styles.generationResponse}`}>
        <div className={styles.avatar}><Bot size={16} /></div>
        <GenerationCard
          batch={batch}
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
  onInspiration,
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
        <div aria-hidden className={styles.heroEmblem}><Sparkles size={29} strokeWidth={1.35} /></div>
        <span className={styles.heroEyebrow}>每一个想法，都值得被看见</span>
        <h1 className={styles.heroTitle}>{zhCN.timeline.emptyTitle}</h1>
        <p className={styles.heroSubtitle}>让脑海里的画面，成为眼前的作品。</p>
        <div aria-label="创作灵感" className={styles.inspirationBubbles}>
          {([
            ['光影与静物', '生成一张晨光下的陶瓷花瓶图片，柔和阴影，留白构图', Sun],
            ['想象一片风景', '生成一张月光下的海岸风景图，静谧蓝调，电影质感', Mountain],
            ['试试创意插画', '生成一张云端花园插画，柔和配色，轻盈梦幻', Sparkles],
          ] as const).map(([label, prompt, Icon]) => (
            <button className={styles.inspirationBubble} key={label} onClick={() => onInspiration?.(prompt)} type="button"><Icon aria-hidden size={16} />{label}<ArrowUpRight aria-hidden size={13} /></button>
          ))}
        </div>
        <a className={styles.commerceEntry} href="/create"><span className={styles.commerceEntryIcon}><ShoppingBag aria-hidden size={21} /></span><span><strong>电商生图<span className={styles.miniBadge}>专属工作流</span></strong><small>从商品主图到成套内容，开始专属创作</small></span><ArrowRight aria-hidden size={18} /></a>
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
          return <GenerationTurn batch={item.batch} key={item.id} onDownloadBatch={onDownloadBatch} onRecreate={onRecreate} />;
        }
        const recovery = chatRecoveryActions[item.id];
        return <Alert action={recovery && onRecoverChat ? <Button disabled={chatRecoveryDisabled} onClick={() => onRecoverChat(item.id)} size="small">{recovery.label}</Button> : undefined} description={item.error.message} key={item.id} showIcon type="error" />;
      })}
      {optimisticImages.map((turn) => (
        <GenerationTurn
          batch={turn.batch}
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
