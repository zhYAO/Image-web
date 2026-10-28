'use client';


import { PreviewImage } from '@/features/controls/PreviewImage';
import { BrainCircuit, CheckCircle2, ChevronDown, Wrench } from 'lucide-react';
import { useMemo, useState, type ComponentProps } from 'react';

import { zhCN } from '@/i18n';

import {
  parseAssistantMessageSegments,
  type AssistantMessageSegment,
  type StructuredSegment,
} from './assistant-message-segments';
import { SafeMarkdown } from './SafeMarkdown';
import styles from './workspace.module.css';

interface AssistantMessageContentProps {
  content: string;
  streaming?: boolean;
}

function SafeMarkdownImage({ alt, src, title }: ComponentProps<'img'> & { node?: unknown }) {
  if (typeof src !== 'string' || !/^https?:\/\//i.test(src)) {
    return null;
  }

  return (
    <PreviewImage
      alt={alt ?? ''}
      className={styles.markdownImage}
      loading="lazy"

      src={src}
      style={{ maxHeight: 520, maxWidth: '100%', objectFit: 'contain' }}
      title={title}
    />
  );
}

function MarkdownContent({ children, streaming }: { children: string; streaming: boolean }) {
  return <SafeMarkdown streaming={streaming} className={styles.markdown} imageComponent={SafeMarkdownImage}>{children}</SafeMarkdown>;
}

function blockLabel(segment: StructuredSegment) {
  const detail = segment.metadata.name ?? segment.metadata.tool ?? segment.metadata.status;
  if (segment.type === 'reasoning') return segment.complete ? '已思考' : '正在思考';
  const label = segment.type === 'tool_call' ? '调用工具' : '工具结果';
  return detail ? `${label} · ${detail}` : label;
}

function StructuredMessageBlock({ segment, streaming }: { segment: StructuredSegment; streaming: boolean }) {
  const [expanded, setExpanded] = useState(!segment.complete);

  const label = blockLabel(segment);
  const Icon = segment.type === 'reasoning'
    ? BrainCircuit
    : segment.type === 'tool_call'
      ? Wrench
      : CheckCircle2;

  return (
    <section className={`${styles.structuredBlock} ${styles[`structuredBlock_${segment.type}`]}`}>
      <button
        aria-expanded={expanded}
        aria-label={label}
        className={styles.structuredBlockSummary}
        onClick={() => setExpanded((value) => !value)}
        type="button"
      >
        <Icon aria-hidden size={15} />
        <span>{label}</span>
        {!segment.complete && <span aria-hidden className={styles.structuredPulse} />}
        <ChevronDown
          aria-hidden
          className={`${styles.structuredChevron} ${expanded ? styles.structuredChevronExpanded : ''}`}
          size={15}
        />
      </button>
      {expanded && (
        <div className={styles.structuredBlockBody}>
          <SegmentList segments={segment.children} streaming={streaming && !segment.complete} />
        </div>
      )}
    </section>
  );
}

function SegmentList({ segments, streaming }: { segments: AssistantMessageSegment[]; streaming: boolean }) {
  return segments.map((segment, index) => (
    segment.type === 'markdown'
      ? <MarkdownContent key={`markdown-${index}`} streaming={streaming}>{segment.content}</MarkdownContent>
      : (
          <StructuredMessageBlock
            key={`${segment.tag}-${index}-${segment.complete ? 'complete' : 'streaming'}`}
            segment={segment}
            streaming={streaming}
          />
        )
  ));
}

export function AssistantMessageContent({ content, streaming = false }: AssistantMessageContentProps) {
  const segments = useMemo(
    () => parseAssistantMessageSegments(content, streaming),
    [content, streaming],
  );

  return (
    <>
      <SegmentList segments={segments} streaming={streaming} />
      {streaming && (
        <span
          aria-label={zhCN.timeline.typing}
          className={styles.streamCursor}
          data-testid="chat-stream-cursor"
        >
          ▍
        </span>
      )}
    </>
  );
}
