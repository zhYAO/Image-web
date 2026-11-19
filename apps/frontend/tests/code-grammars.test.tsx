import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { codeGrammar } from '../../web/features/workspace/code-grammars';
import { SafeMarkdown } from '../../web/features/workspace/SafeMarkdown';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('bounded shared code highlighting', () => {
  it('resolves common aliases and denies unsupported or object-property labels', () => {
    for (const [label, canonical] of [['JS', 'javascript'], ['py', 'python'], ['bash', 'shellscript'], ['yml', 'yaml'], ['rs', 'rust']] as const) {
      expect(codeGrammar(label)?.language).toBe(canonical);
    }
    for (const label of ['emacs-lisp', 'cpp', 'unknown', 'constructor', '__proto__', '../javascript']) {
      expect(codeGrammar(label)).toBeUndefined();
    }
  });

  it('loads the actual retained grammars and highlights representative text', async () => {
    const { createHighlighterCore } = await import('shiki/core');
    const { createJavaScriptRegexEngine } = await import('shiki/engine/javascript');
    const theme = await import('shiki/themes/github-dark.mjs');
    const highlighter = await createHighlighterCore({ themes: [theme.default], langs: [], engine: createJavaScriptRegexEngine() });
    try {
      for (const label of ['javascript', 'typescript', 'jsx', 'tsx', 'json', 'html', 'css', 'python', 'shellscript', 'sql', 'markdown', 'yaml', 'rust', 'java']) {
        const grammar = codeGrammar(label)!;
        await highlighter.loadLanguage(await grammar.load());
        const source = 'value = "text"; <tag> 中文';
        const tokens = highlighter.codeToTokens(source, { lang: grammar.language, theme: 'github-dark' }).tokens;
        expect(tokens.map(line => line.map(token => token.content).join('')).join('\n')).toBe(source);
      }
    } finally { highlighter.dispose(); }
  });

  it('preserves escaped unsupported source and exact clipboard text after a highlighted fence', async () => {
    const copy = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText: copy } });
    const { container, rerender } = render(<SafeMarkdown>{'```py\nprint(42)\n```'}</SafeMarkdown>);
    await waitFor(() => expect(container.querySelector('pre.shiki code span[style]')).not.toBeNull());
    const source = '  <script>text</script>\n\t(value 42)  \n';
    rerender(<SafeMarkdown>{'```emacs-lisp\n' + source + '\n```'}</SafeMarkdown>);
    expect(container.querySelector('pre.shiki')).toBeNull();
    expect(container.querySelector('code')?.textContent).toBe(source);
    expect(container.querySelector('script')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '\u590d\u5236\u4ee3\u7801' }));
    await waitFor(() => expect(copy).toHaveBeenCalledWith(source));
  });
});
