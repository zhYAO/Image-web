import type { GenerationBatch, RecreateScope, Skill, TimelineItem } from '@zimage/domain';
import { Alert, Button, Spin, Tag } from 'antd';
import { Bot, Download, ImageOff, RefreshCw, UserRound } from 'lucide-react';
import Image from 'next/image';

import { zhCN } from '@/i18n';

import styles from './workspace.module.css';

const statusLabels: Record<GenerationBatch['status'], string> = {
  ...zhCN.timeline.status,
};

interface WorkspaceTimelineProps {
  awaitingFirstDelta?: boolean;
  isChatStreaming?: boolean;
  items: TimelineItem[];
  skills: Skill[];
  streamingText: string;
  onDownloadBatch: (batch: GenerationBatch) => void;
  onRecreate: (batch: GenerationBatch, scope: RecreateScope, generationId?: string) => void;
  onSelectSkill: (skillId: string) => void;
}

function GenerationCard({
  batch,
  onDownloadBatch,
  onRecreate,
}: {
  batch: GenerationBatch;
  onDownloadBatch: (batch: GenerationBatch) => void;
  onRecreate: (batch: GenerationBatch, scope: RecreateScope, generationId?: string) => void;
}) {
  const completed = batch.assets.filter((asset) => asset.status === 'succeeded' && !asset.expired);
  const failed = batch.assets.filter((asset) => asset.status === 'failed');
  return (
    <article className={styles.generationCard} data-status={batch.status}>
      <header className={styles.generationHeader}>
        <span className={styles.generationPrompt}>{batch.prompt}</span>
        <Tag color={batch.status === 'failed' ? 'red' : batch.status === 'partial' ? 'orange' : 'purple'}>
          {statusLabels[batch.status]}
        </Tag>
      </header>
      <div className={styles.generationMeta}>
        {batch.provider} · {batch.model} · {batch.config.aspectRatio} · {batch.config.resolution}
      </div>
      <div className={styles.assetGrid}>
        {batch.assets.map((asset, index) => (
          <div className={styles.asset} key={asset.id}>
            {asset.status === 'succeeded' && asset.url ? (
              <Image alt={`生成结果 ${index + 1}`} height={720} priority={false} src={asset.url} unoptimized width={720} />
            ) : null}
            {asset.status === 'pending' && (
              <div className={styles.assetState}><span>{zhCN.timeline.state.pending}</span></div>
            )}
            {asset.status === 'processing' && (
              <div className={styles.assetState}><Spin size="small" /><span>{zhCN.timeline.state.processing}</span></div>
            )}
            {asset.status === 'failed' && (
              <div className={styles.assetState}><ImageOff size={23} /><span>{asset.error?.message}</span></div>
            )}
            {asset.expired && (
              <div className={`${styles.assetState} ${styles.expired}`}>
                <span>{zhCN.timeline.expired}</span>
              </div>
            )}
            {(asset.status === 'succeeded' || asset.status === 'failed') && (
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
          {failed.length > 0 && (
            <Button icon={<RefreshCw size={14} />} onClick={() => onRecreate(batch, 'failed')} size="small">{zhCN.timeline.recreateFailed}</Button>
          )}
          {batch.assets.some((asset) => asset.expired) && (
            <Button icon={<RefreshCw size={14} />} onClick={() => onRecreate(batch, 'all')} size="small" type="primary">{zhCN.timeline.recreateAll}</Button>
          )}
        </div>
      </footer>
    </article>
  );
}

export function WorkspaceTimeline({
  awaitingFirstDelta = false,
  isChatStreaming = false,
  items,
  skills,
  streamingText,
  onDownloadBatch,
  onRecreate,
  onSelectSkill,
}: WorkspaceTimelineProps) {
  if (items.length === 0 && !streamingText && !awaitingFirstDelta) {
    return (
      <div className={styles.empty}>
        <h1 className={styles.heroTitle}>{zhCN.timeline.emptyTitle}</h1>
        <div className={styles.skillGrid}>
          {skills.map((skill) => (
            <button aria-label={`${skill.name}：${skill.description}`} className={styles.skillCard} key={skill.id} onClick={() => onSelectSkill(skill.id)} type="button">
              <span className={styles.skillCover}>
                {skill.coverImageUrl ? (
                  <Image alt="" fill sizes="(max-width: 900px) 100vw, 300px" src={skill.coverImageUrl} />
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
              <div className={styles.bubble}>{item.content}</div>
            </article>
          );
        }
        if (item.type === 'generation') {
          return <GenerationCard batch={item.batch} key={item.id} onDownloadBatch={onDownloadBatch} onRecreate={onRecreate} />;
        }
        return <Alert action={item.actionLabel ? <Button size="small">{item.actionLabel}</Button> : undefined} description={item.error.message} key={item.id} showIcon type="error" />;
      })}
      {(streamingText || awaitingFirstDelta) && (
        <article className={styles.message}>
          <div className={styles.avatar}><Bot size={16} /></div>
          {streamingText ? (
            <div className={styles.bubble}>
              {streamingText}
              {/* Trailing cursor only while the model is actively producing
                  bytes. The instant the stream ends the cursor disappears so
                  the bubble looks finalized rather than mid-typing. */}
              {isChatStreaming && (
                <span aria-label={zhCN.timeline.typing} data-testid="chat-stream-cursor"> ▍</span>
              )}
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
