import { describe, expect, it } from 'vitest';
import { createHighlighterCore } from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';
import theme from 'shiki/themes/github-dark.mjs';
import { codeGrammar } from '../../web/features/workspace/code-grammars';
import { createTokenHighlighter } from '../../web/features/workspace/token-highlighter';

describe('token-only public Shiki facade', () => {
  it('matches the original complete token output for all retained grammars', async () => {
    const original = await createHighlighterCore({ themes: [theme], langs: [], engine: createJavaScriptRegexEngine() });
    const narrow = await createTokenHighlighter({ themes: [theme], langs: [], engine: createJavaScriptRegexEngine() });
    const samples: Record<string, string> = {
      javascript: '/* comment */\nconst value = `hello ${42}`;\nconsole.log(value);',
      typescript: 'interface Box<T> { value: T }\nconst x: Box<number> = { value: 42 };',
      jsx: 'const View = () => <div className="x">{value /* comment */}</div>;',
      tsx: 'const View = <T,>({ value }: { value: T }) => <div>{String(value)}</div>;',
      json: '{"key": [true, null, 42, "text"]}', html: '<!-- comment -->\n<div title="value">text &amp; more</div>',
      css: '/* comment */\n.box:hover { color: #fff; margin: 1rem; }',
      python: '# comment\ndef value(x: int):\n    return f"hello {x}"',
      shellscript: '#!/bin/sh\nfor item in "$@"; do echo "$item"; done',
      sql: '-- comment\nSELECT name, COUNT(*) FROM items WHERE id > 1 GROUP BY name;',
      markdown: '# Heading\n**bold** and [link](https://example.invalid)\n```js\nconst x=1\n```',
      yaml: '# comment\nkey:\n  - name: value\n    enabled: true',
      rust: '// comment\nfn main() { let value: Option<i32> = Some(42); println!("{:?}", value); }',
      java: '// comment\nclass Test { public static void main(String[] args) { System.out.println(42); } }',
    };
    try {
      for (const [label, sample] of Object.entries(samples)) {
        const grammar = codeGrammar(label)!;
        const loaded = await grammar.load();
        await original.loadLanguage(loaded); await narrow.loadLanguage(loaded);
        for (const source of [sample, '\t<>&"\n中文🙂\r\n  \n', '']) {
          const options = { lang: grammar.language, theme: 'github-dark' };
          // Compare positions, styles, colors and text, rather than text preservation alone.
          expect(narrow.codeToTokens(source, options)).toEqual(original.codeToTokens(source, options));
        }
      }
      expect(() => narrow.codeToTokens('text', { lang: 'unknown-grammar', theme: 'github-dark' })).toThrow();
    } finally { original.dispose(); narrow.dispose(); }
  });
});
