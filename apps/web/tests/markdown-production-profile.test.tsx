import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AssistantMessageContent } from '@/features/workspace/AssistantMessageContent';

describe('production Markdown features retained by the build profile', () => {
  it('retains ordinary and diagram/HTML code fences, CJK, tables, safe links and image previews', async () => {
    const content = '# 中文说明\n\n| 尺码 | 材质 |\n| --- | --- |\n| M | 棉 |\n\n'
      + '```mermaid\ngraph TD\n A-->B\n```\n\n```html\n<script>window.bad=1</script>\n```\n\n'
      + '[安全链接](https://example.com) [危险链接](javascript:alert(1))\n\n![样图](https://example.com/item.webp)\n\n'
      + '> [!NOTE]\n> 原本未启用的提示仍显示文字\n\n价格 $20；公式 $x+y$ 保持原有文本。';
    const { container } = render(<AssistantMessageContent content={content} />);
    expect(screen.getByRole('heading', { name: '中文说明' })).toBeInTheDocument();
    expect(screen.getByRole('table')).toHaveTextContent('棉');
    await waitFor(() => expect(container.querySelectorAll('pre').length).toBeGreaterThanOrEqual(2));
    expect(container.textContent).toContain('graph TD');
    expect(container.textContent).toContain('<script>window.bad=1</script>');
    expect(container.querySelector('script, iframe, .katex, .markdown-alert')).toBeNull();
    expect(screen.getByRole('link', { name: '安全链接' })).toHaveAttribute('href', 'https://example.com');
    expect(screen.getByText('危险链接').closest('a')).not.toHaveAttribute('href', expect.stringMatching(/^javascript:/));
    expect(screen.getByRole('img', { name: '样图' })).toHaveAttribute('src', 'https://example.com/item.webp');
    expect(container.textContent).toContain('$x+y$');
  });

  it('keeps streamed code text through final fences and structured reasoning blocks', async () => {
    const { container, rerender } = render(<AssistantMessageContent content={'<think>推理内容</think>\n```python\nprint("中文")'} streaming />);
    expect(screen.getByRole('button', { name: '已思考' })).toBeInTheDocument();
    await waitFor(() => expect(container.textContent).toContain('中文'));
    rerender(<AssistantMessageContent content={'<think>推理内容</think>\n```python\nprint("中文")\n```'} />);
    await waitFor(() => expect(container.textContent).toContain('print'));
    expect(container.textContent).toContain('中文');
    expect(container.querySelector('pre code')).not.toBeNull();
  });

  it('actually colors Python tokens and copies the unchanged source text', async () => {
    const writeText = vi.fn(async () => undefined);
    const descriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const source = 'print("中文")\nvalue = 42';
    try {
      const { container } = render(<AssistantMessageContent content={`\`\`\`python\n${source}\n\`\`\``} />);
      await waitFor(() => expect(container.querySelector('pre.shiki code span[style]')).not.toBeNull());
      expect(container.querySelector('pre.shiki code')).toHaveTextContent('中文');
      fireEvent.click(screen.getByRole('button'));
      await waitFor(() => expect(writeText).toHaveBeenCalledWith(source));
    } finally {
      if (descriptor) Object.defineProperty(navigator, 'clipboard', descriptor);
      else Reflect.deleteProperty(navigator, 'clipboard');
    }
  });
});
