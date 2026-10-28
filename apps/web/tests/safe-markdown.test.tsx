import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { SafeMarkdown, safeMarkdownUrl } from '@/features/workspace/SafeMarkdown';

describe('SafeMarkdown', () => {
  it('server-renders CJK, GFM and escaped incomplete code without raw HTML', () => {
    const html = renderToStaticMarkup(<SafeMarkdown>{'# 中文\n\n~~删除~~\n\n- [x] 完成\n\n| A | B |\n| - | - |\n| 一 | 二 |\n\n<script>alert(1)</script>\n\n```unknown\n<img onerror="bad()">'}</SafeMarkdown>);
    expect(html).toContain('中文');
    expect(html).toContain('<del>删除</del>');
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('<table>');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;img onerror=');
  });

  it('rejects unsafe protocols and image sources', () => {
    const node = { type: 'element' as const, tagName: 'a', properties: {}, children: [] };
    for (const url of ['javascript:alert(1)', 'java\nscript:alert(1)', 'data:text/html,bad', 'vbscript:bad']) {
      expect(safeMarkdownUrl(url, 'href', node)).toBe('');
    }
    expect(safeMarkdownUrl('/workspace', 'href', node)).toBe('/workspace');
    expect(safeMarkdownUrl('mailto:a@example.com', 'href', node)).toBe('mailto:a@example.com');
    render(<SafeMarkdown>{'![bad](data:image/png;base64,aaa) ![relative](/private.png) [safe](https://example.com)'}</SafeMarkdown>);
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByRole('link')).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('copies unchanged whitespace from incomplete and completed unknown fences', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const source = '  <tag>\n\tvalue  \n';
    try {
      const { rerender, container } = render(<SafeMarkdown>{'```unknown\n' + source}</SafeMarkdown>);
      fireEvent.click(screen.getByRole('button', { name: '复制代码' }));
      await waitFor(() => expect(writeText).toHaveBeenCalledWith(source.slice(0, -1)));
      rerender(<SafeMarkdown>{'```unknown\n' + source + '\n```'}</SafeMarkdown>);
      fireEvent.click(screen.getByRole('button', { name: '复制代码' }));
      await waitFor(() => expect(writeText).toHaveBeenLastCalledWith(source));
      expect(container.querySelector('tag')).toBeNull();
    } finally { vi.unstubAllGlobals(); }
  });
  it('renders raw HTML and unknown controlled tags literally without creating elements', () => {
    const content = '<unknown>原文</unknown>\n\n<script>alert(1)</script>\n\n<think>';
    const { container } = render(<SafeMarkdown>{content}</SafeMarkdown>);
    expect(container.textContent).toContain('<unknown>原文</unknown>');
    expect(container.textContent).toContain('<script>alert(1)</script>');
    expect(container.textContent).toContain('<think>');
    expect(container.querySelector('unknown, script, think')).toBeNull();
  });

  it('loads languages and aliases beyond the common set on demand', async () => {
    const { container, rerender } = render(<SafeMarkdown>{'```rust\nfn main() { let value = 42; }\n```'}</SafeMarkdown>);
    await waitFor(() => expect(container.querySelector('pre.shiki code span[style]')).not.toBeNull());
    rerender(<SafeMarkdown>{'```java\npublic class Example {}\n```'}</SafeMarkdown>);
    await waitFor(() => expect(container.querySelector('pre.shiki code span[style]')).not.toBeNull());
    rerender(<SafeMarkdown>{'```py\nprint(42)\n```'}</SafeMarkdown>);
    await waitFor(() => expect(container.querySelector('pre.shiki code span[style]')).not.toBeNull());
  });

  it('announces clipboard failure accessibly', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } });
    try {
      render(<SafeMarkdown>{'```text\ncopy me\n```'}</SafeMarkdown>);
      fireEvent.click(screen.getByRole('button', { name: '复制代码' }));
      await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('复制失败，请重试'));
    } finally { vi.unstubAllGlobals(); }
  });

  it('keeps preview wrappers outside paragraphs, including linked images', () => {
    const { container } = render(<SafeMarkdown imageComponent={({ alt }) => <div>{alt}</div>}>{'ordinary text\n\n[![preview](https://example.com/a.png)](https://example.com)'}</SafeMarkdown>);
    expect(container.querySelector('p')).toHaveTextContent('ordinary text');
    expect(container.querySelector('p a')).toBeNull();
    expect(screen.getByRole('link')).toHaveTextContent('preview');
  });

  it('repairs streamed emphasis without changing code or final literal text', () => {
    const content = '**未完成\n\n```text\n**code';
    const { container, rerender } = render(<SafeMarkdown streaming>{content}</SafeMarkdown>);
    expect(container.querySelector('strong')).toHaveTextContent('未完成');
    expect(container.querySelector('pre code')?.textContent).toBe('**code');
    rerender(<SafeMarkdown>{content}</SafeMarkdown>);
    expect(container.querySelector('strong')).toBeNull();
  });

  it.each([
    ['*italic', '*italic*', 'em', 'italic'],
    ['_italic', '_italic_', 'em', 'italic'],
    ['__strong', '__strong__', 'strong', 'strong'],
    ['**first\nsecond', '**first\nsecond**', 'strong', 'first second'],
    ['# **heading', '# **heading**', 'h1 strong', 'heading'],
  ])('repairs streamed %s through completion', (partial, complete, selector, text) => {
    const { container, rerender } = render(<SafeMarkdown streaming>{partial}</SafeMarkdown>);
    expect(container.querySelector(selector)).toHaveTextContent(text);
    rerender(<SafeMarkdown>{complete}</SafeMarkdown>);
    expect(container.querySelector(selector)).toHaveTextContent(text);
  });

  it.each(['\\*\\*literal', '&#42;&#42;literal', '&ast;&ast;literal', '\\_\\_literal'])('keeps literal source markers %s inert during streaming and completion', (source) => {
    const { container, rerender } = render(<SafeMarkdown streaming>{source}</SafeMarkdown>);
    const text = container.textContent;
    expect(container.querySelector('strong, em')).toBeNull();
    rerender(<SafeMarkdown>{source}</SafeMarkdown>);
    expect(container.querySelector('strong, em')).toBeNull();
    expect(container.textContent).toBe(text);
  });

  it.each(['```text\n**literal ', '~~~text\n__literal ', '    *literal ', '`**literal`'])('preserves code source during repair: %s', (source) => {
    const { container, rerender } = render(<SafeMarkdown streaming>{source}</SafeMarkdown>);
    const code = container.querySelector('code')?.textContent;
    expect(container.querySelector('strong, em')).toBeNull();
    rerender(<SafeMarkdown>{source}</SafeMarkdown>);
    expect(container.querySelector('code')?.textContent).toBe(code);
  });

  it.each([
    ['> **first\n> second', '> **first\n> second**', 'blockquote strong'],
    ['> > **first\n> > second', '> > **first\n> > second**', 'blockquote blockquote strong'],
    ['- **first\n  second', '- **first\n  second**', 'li strong'],
    ['> - **first\n>   second', '> - **first\n>   second**', 'blockquote li strong'],
    ['> **first `code`\n> second', '> **first `code`\n> second**', 'blockquote strong'],
    ['- **first `code`\n  second', '- **first `code`\n  second**', 'li strong'],
  ])('preserves multiline container text while streaming: %s', (partial, complete, selector) => {
    const { container, rerender } = render(<SafeMarkdown streaming>{partial}</SafeMarkdown>);
    expect(container.querySelector(selector)).toHaveTextContent(/first.*second/s);
    expect(container.textContent).toContain('second');
    const text = container.textContent;
    if (partial.includes('`code`')) expect(container.querySelector('code')).toHaveTextContent('code');
    rerender(<SafeMarkdown>{complete}</SafeMarkdown>);
    expect(container.querySelector(selector)).toHaveTextContent(/first.*second/s);
    expect(container.textContent).toBe(text);
  });

  it('keeps following fenced code intact in nested quote/list streaming content', () => {
    const partial = '> - **first\n>   second\n>\n>   ```text\n>   **literal\n>   ```';
    const { container, rerender } = render(<SafeMarkdown streaming>{partial}</SafeMarkdown>);
    expect(container.querySelector('blockquote li strong')).toHaveTextContent('first second');
    expect(container.querySelector('pre code')?.textContent).toBe('**literal');
    rerender(<SafeMarkdown>{partial.replace('second', 'second**')}</SafeMarkdown>);
    expect(container.querySelector('blockquote li strong')).toHaveTextContent('first second');
    expect(container.querySelector('pre code')?.textContent).toBe('**literal');
  });

});
