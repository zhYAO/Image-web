'use client';

import Markdown from '@lobehub/ui/es/Markdown/Markdown';
import type { MarkdownProps } from '@lobehub/ui/es/Markdown/type';
import LobeImage from '@lobehub/ui/es/Image/index';
import type { ComponentProps } from 'react';

import { zhCN } from '@/i18n';

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

export function AssistantMessageContent({ content, streaming = false }: AssistantMessageContentProps) {
  return (
    <>
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
        {content}
      </Markdown>
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
