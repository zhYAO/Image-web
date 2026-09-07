import type { GenerationBatch, RecreateScope, Skill, TimelineItem } from '@zimage/domain';
import { Alert, Button, Image as AntdImage, Spin, Tag } from 'antd';
import { Bot, Download, ImageOff, RefreshCw, UserRound } from 'lucide-react';
import NextImage from 'next/image';

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
  skills: Skill[];
  streamingText: string;
  onDownloadBatch: (batch: GenerationBatch) => void;
  onRecreate: (batch: GenerationBatch, scope: RecreateScope, generationId?: string) => void;
  onRetryImage?: (turnId: string) => void;
  onRetryLoad?: () => void;
  onSelectSkill: (skillId: string) => void;
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
  skills,
  streamingText,
  onDownloadBatch,
  onRecreate,
  onRetryImage,
  onRetryLoad,
  onSelectSkill,
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
        <h1 className={styles.heroTitle}>{zhCN.timeline.emptyTitle}</h1>
        <div className={styles.skillGrid}>
          {skills.map((skill) => (
            <button aria-label={`${skill.name}：${skill.description}`} className={`${styles.skillCard} ${!skill.coverImageUrl ? styles.skillCardCompact : ''}`} key={skill.id} onClick={() => onSelectSkill(skill.id)} type="button">
              <span className={styles.skillCover}>
                {skill.coverImageUrl ? (
                  <NextImage alt="" fill sizes="(max-width: 900px) 100vw, 300px" src={skill.coverImageUrl} />
                ) : (
                  <span className={styles.skillIcon}>{skill.icon}</span>
                )}
                <span className={styles.skillCoverShade} />
                <span className={styles.skillCoverTitle}>{skill.name}</span>
                <span className={styles.tryButton}>试一试</span>
              </span>
              <span className={styles.skillDescription}>{skill.description}</span>
            </button>
          ))}
        </div>
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
        return <Alert action={item.actionLabel ? <Button size="small">{item.actionLabel}</Button> : undefined} description={item.error.message} key={item.id} showIcon type="error" />;
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
