'use client';

import Markdown from '@lobehub/ui/es/Markdown/Markdown';
import type { MarkdownProps } from '@lobehub/ui/es/Markdown/type';
import LobeImage from '@lobehub/ui/es/Image/index';
import { BrainCircuit, CheckCircle2, ChevronDown, Wrench } from 'lucide-react';
import { useMemo, useState, type ComponentProps } from 'react';

import { zhCN } from '@/i18n';

import {
  parseAssistantMessageSegments,
  type AssistantMessageSegment,
  type StructuredSegment,
} from './assistant-message-segments';
import styles from './workspace.module.css';

interface AssistantMessageContentProps {
  content: string;
  streaming?: boolean;
}

const markdownComponentProps: MarkdownProps['componentProps'] = {
  a: {
    rel: 'noopener noreferrer',
  },
  highlight: {
    copyable: true,
    showLanguage: true,
  },
};

function SafeMarkdownImage({ alt, src, title }: ComponentProps<'img'> & { node?: unknown }) {
  if (typeof src !== 'string' || !/^https?:\/\//i.test(src)) {
    return null;
  }

  return (
    <LobeImage
      alt={alt ?? ''}
      className={styles.markdownImage}
      loading="lazy"
      maxHeight={520}
      maxWidth="100%"
      objectFit="contain"
      preview={false}
      src={src}
      title={title}
      variant="outlined"
    />
  );
}

const markdownComponents: MarkdownProps['components'] = {
  img: SafeMarkdownImage,
};

const markdownParserProps: MarkdownProps['reactMarkdownProps'] = {
  urlTransform(value, _key, node) {
    const normalized = value.trim();
    const compact = normalized.replace(/[\u0000-\u0020\u007f-\u009f]/g, '');

    if (node.tagName === 'img') {
      return /^https?:\/\//i.test(compact) ? normalized : '';
    }

    const scheme = /^([a-z][a-z\d+.-]*):/i.exec(compact)?.[1]?.toLowerCase();
    if (!scheme || scheme === 'http' || scheme === 'https' || scheme === 'mailto') {
      return normalized;
    }

    return '';
  },
};

function MarkdownContent({ children, streaming }: { children: string; streaming: boolean }) {
  return (
    <Markdown
      allowHtml={false}
      animated={streaming}
      borderRadius={10}
      className={styles.markdown}
      componentProps={markdownComponentProps}
      components={markdownComponents}
      enableHtmlPreview={false}
      enableImageGallery={false}
      enableLatex={false}
      enableMermaid={false}
      enableStream={streaming}
      fontSize={15}
      lineHeight={1.7}
      reactMarkdownProps={markdownParserProps}
      streamAnimationGranularity="word"
      streamSmoothingPreset="realtime"
      variant="chat"
    >
      {children}
    </Markdown>
  );
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
