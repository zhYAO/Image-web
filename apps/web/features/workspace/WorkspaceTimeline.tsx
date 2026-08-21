import type { GenerationBatch, Skill, TimelineItem } from '@zimage/domain';
import { Alert, Button, Spin, Tag } from 'antd';
import { Bot, Download, ImageOff, RefreshCw, UserRound } from 'lucide-react';
import Image from 'next/image';

import styles from './workspace.module.css';

const statusLabels: Record<GenerationBatch['status'], string> = {
  failed: '失败',
  partial: '部分成功',
  pending: '排队中',
  processing: '生成中',
  succeeded: '已完成',
};

interface WorkspaceTimelineProps {
  items: TimelineItem[];
  skills: Skill[];
  streamingText: string;
  onDownloadBatch: (batch: GenerationBatch) => void;
  onRecreate: (batch: GenerationBatch, scope: 'failed' | 'all') => void;
  onSelectSkill: (skillId: string) => void;
}

function GenerationCard({
  batch,
  onDownloadBatch,
  onRecreate,
}: {
  batch: GenerationBatch;
  onDownloadBatch: (batch: GenerationBatch) => void;
  onRecreate: (batch: GenerationBatch, scope: 'failed' | 'all') => void;
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
      <div className={styles.assetGrid}>
        {batch.assets.map((asset, index) => (
          <div className={styles.asset} key={asset.id}>
            {asset.status === 'succeeded' && asset.url ? (
              <Image alt={`生成结果 ${index + 1}`} height={720} priority={false} src={asset.url} unoptimized width={720} />
            ) : null}
            {asset.status === 'pending' && (
              <div className={styles.assetState}><span>等待队列处理</span></div>
            )}
            {asset.status === 'processing' && (
              <div className={styles.assetState}><Spin size="small" /><span>正在生成画面</span></div>
            )}
            {asset.status === 'failed' && (
              <div className={styles.assetState}><ImageOff size={23} /><span>{asset.error?.message}</span></div>
            )}
            {asset.expired && (
              <div className={`${styles.assetState} ${styles.expired}`}>
                <span>原图已到期，可按原参数重新生成</span>
              </div>
            )}
          </div>
        ))}
      </div>
      <footer className={styles.generationFooter}>
        <span className={styles.muted}>{batch.source === 'chat_tool' ? '由聊天工具生成' : '直接生图'}</span>
        <div className={styles.actionGroup}>
          {completed.length > 0 && (
            <Button icon={<Download size={14} />} onClick={() => onDownloadBatch(batch)} size="small">批量下载</Button>
          )}
          {failed.length > 0 && (
            <Button icon={<RefreshCw size={14} />} onClick={() => onRecreate(batch, 'failed')} size="small">重试失败项</Button>
          )}
          {batch.assets.some((asset) => asset.expired) && (
            <Button icon={<RefreshCw size={14} />} onClick={() => onRecreate(batch, 'all')} size="small" type="primary">按原参数生成</Button>
          )}
        </div>
      </footer>
    </article>
  );
}

export function WorkspaceTimeline({
  items,
  skills,
  streamingText,
  onDownloadBatch,
  onRecreate,
  onSelectSkill,
}: WorkspaceTimelineProps) {
  if (items.length === 0 && !streamingText) {
    return (
      <div className={styles.empty}>
        <div className={styles.heroMark}>Z</div>
        <h1 className={styles.heroTitle}>让灵感，从一句话变成画面</h1>
        <p className={styles.heroSubtitle}>在同一个时间线里和 AI 对话、完善想法并生成图片。选择一个快捷技能，或直接从下方输入框开始。</p>
        <div className={styles.skillGrid}>
          {skills.map((skill) => (
            <button aria-label={`${skill.name}：${skill.description}`} className={styles.skillCard} key={skill.id} onClick={() => onSelectSkill(skill.id)} type="button">
              <span className={styles.skillIcon}>{skill.icon}</span>
              <span className={styles.skillName}>{skill.name}</span>
              <span className={styles.muted}>{skill.description}</span>
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
      {streamingText && (
        <article className={styles.message}>
          <div className={styles.avatar}><Bot size={16} /></div>
          <div className={styles.bubble}>{streamingText}<span aria-label="正在输入"> ▍</span></div>
        </article>
      )}
    </div>
  );
}
