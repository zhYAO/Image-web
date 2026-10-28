'use client';

import { Children, isValidElement, useEffect, useState, type ComponentProps, type ReactNode } from 'react';
import ReactMarkdown, { type Components, type ExtraProps, type UrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remend from 'remend';
import type { HighlighterCore, ThemedToken } from 'shiki/core';

import styles from './safe-markdown.module.css';

// Lazy registry entries load individual grammars on demand; no WASM engine is bundled.
let highlighter: Promise<HighlighterCore> | undefined;
function getHighlighter() {
  return highlighter ??= Promise.all([
    import('shiki/core'),
    import('shiki/engine/javascript'),
    import('shiki/themes/github-dark.mjs'),
  ]).then(([{ createHighlighterCore }, { createJavaScriptRegexEngine }, theme]) => createHighlighterCore({
    themes: [theme.default], langs: [], engine: createJavaScriptRegexEngine(),
  }));
}

export const safeMarkdownUrl: UrlTransform = (value, _key, node) => {
  const normalized = value.trim();
  const compact = normalized.replace(/[\u0000-\u0020\u007f-\u009f]/g, '');
  if (node.tagName === 'img') return /^https?:\/\//i.test(compact) ? normalized : '';
  const scheme = /^([a-z][a-z\d+.-]*):/i.exec(compact)?.[1]?.toLowerCase();
  return !scheme || ['http', 'https', 'mailto'].includes(scheme) ? normalized : '';
};

function CodeBlock({ children }: { children?: ReactNode }) {
  const child = Children.toArray(children)[0];
  const props = isValidElement<{ children?: string; className?: string }>(child) ? child.props : {};
  // Markdown supplies a synthetic terminal newline; remove only that newline for copying.
  const source = String(props.children ?? '').replace(/\n$/, '');
  const label = /language-([^\s]+)/.exec(props.className ?? '')?.[1] ?? 'text';
  const language = label.toLowerCase();
  const [highlight, setHighlight] = useState<{ source: string; language: string; lines: ThemedToken[][] }>();
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  useEffect(() => {
    let active = true;
    void import('shiki/langs').then(async ({ bundledLanguages }) => {
      if (!active) return;
      const loader = bundledLanguages[language as keyof typeof bundledLanguages];
      if (!loader) return;
      const [instance, grammar] = await Promise.all([getHighlighter(), loader()]);
      if (!active) return;
      await instance.loadLanguage(grammar);
      if (!active) return;
      const lines = instance.codeToTokens(source, { lang: language, theme: 'github-dark' }).tokens;
      if (active) setHighlight({ source, language, lines });
    }).catch(() => { /* Unsupported grammar/runtime: keep escaped plain text. */ });
    return () => { active = false; };
  }, [source, language]);
  const lines = highlight?.source === source && highlight.language === language ? highlight.lines : undefined;
  return (
    <div className={styles.codeBlock}>
      <div className={styles.codeToolbar}>
        <span>{label}</span>
        <button type="button" aria-label="复制代码" onClick={async () => {
          try { await navigator.clipboard.writeText(source); setCopyState('copied'); }
          catch { setCopyState('failed'); }
        }}>{copyState === 'copied' ? '已复制' : copyState === 'failed' ? '复制失败' : '复制'}</button>
        <span role="status" aria-live="polite">{copyState === 'failed' ? '复制失败，请重试' : copyState === 'copied' ? '代码已复制' : ''}</span>
      </div>
      <pre className={lines ? 'shiki' : undefined}><code className={props.className}>{lines
        ? lines.map((line, index) => <span key={index}>{index > 0 ? '\n' : ''}{line.map((token, tokenIndex) => (
            <span key={tokenIndex} style={{ color: token.color, fontStyle: token.fontStyle && token.fontStyle & 1 ? 'italic' : undefined, fontWeight: token.fontStyle && token.fontStyle & 2 ? 'bold' : undefined }}>{token.content}</span>
          ))}</span>)
        : source}</code></pre>
    </div>
  );
}

function SafeImage({ src, alt, node, ...props }: ComponentProps<'img'> & ExtraProps) {
  void node;
  // Reject empty/relative URLs even when a caller uses the default image renderer.
  return typeof src === 'string' && /^https?:\/\//i.test(src)
    // eslint-disable-next-line @next/next/no-img-element
    ? <img {...props} src={src} alt={alt ?? ''} loading="lazy" /> : null;
}

type MarkdownNode = {
  type: string;
  children?: MarkdownNode[];
  position?: { start: { offset?: number }; end: { offset?: number } };
};

// Repair raw inline-container source, before escapes/entities are decoded. Reuse
// the existing parser and leave fenced/indented code nodes and their source alone.
function streamingEmphasis(this: { parse: (source: string) => MarkdownNode }) {
  const parse = this.parse.bind(this);
  return (tree: MarkdownNode, file: { value: unknown }) => {
    const source = String(file.value);
    const visit = (node: MarkdownNode) => {
      if (node.type === 'paragraph' || node.type === 'heading') {
        const start = node.position?.start.offset;
        const end = node.position?.end.offset;
        if (start === undefined || end === undefined) return;
        const raw = source.slice(start, end);
        const repaired = remend(raw, {
          comparisonOperators: false, htmlTags: false, images: false,
          inlineCode: false, inlineKatex: false, katex: false, links: false,
          setextHeadings: false, singleTilde: false, strikethrough: false,
        });
        // Only append delimiters. Parse in the original document context so
        // quote/list continuation prefixes cannot turn into discarded root nodes.
        if (repaired !== raw && repaired.startsWith(raw)) {
          const repairedTree = parse(source.slice(0, end) + repaired.slice(raw.length));
          const findContainer = (candidate: MarkdownNode): MarkdownNode | undefined => {
            if (candidate.type === node.type && candidate.position?.start.offset === start) return candidate;
            for (const child of candidate.children ?? []) {
              const match = findContainer(child);
              if (match) return match;
            }
          };
          const replacement = findContainer(repairedTree);
          if (replacement?.position?.end.offset === end + repaired.length - raw.length) {
            node.children = replacement.children;
          }
        }
        return;
      }
      node.children?.forEach(visit);
    };
    visit(tree);
  };
}

export function SafeMarkdown({ children, className, imageComponent, streaming = false }: {
  children: string;
  streaming?: boolean;
  className?: string;
  imageComponent?: Components['img'];
}) {
  return <div className={`${styles.markdown} ${className ?? ''}`}><ReactMarkdown
    remarkPlugins={streaming ? [remarkGfm, streamingEmphasis] : [remarkGfm]}
    urlTransform={safeMarkdownUrl}
    components={{
      a: ({ href, children, title }) => <a href={href} title={title} rel="noopener noreferrer" target="_blank">{children}</a>,
      img: imageComponent ?? SafeImage,
      pre: CodeBlock,
      p: ({ node, children }) => {
        const hasImage = (element: NonNullable<typeof node>): boolean => element.children.some((child) =>
          child.type === 'element' && (child.tagName === 'img' || hasImage(child)));
        return node && hasImage(node) ? <div>{children}</div> : <p>{children}</p>;
      },
    }}
  >{children}</ReactMarkdown></div>;
}
