import { describe, expect, it } from 'vitest';
import { renderDocument, collectStyles } from '../scripts/prerender.mjs';

const template = '<html lang="zh-CN"><head><title>old</title><meta name="description" content="old" /><meta name="robots" content="noindex,nofollow" /></head><body><div id="root"><!--zimage:root--></div><script type="module" src="/frontend-assets/release/assets/main.js"></script></body></html>';
const page = { title: 'ZImage & 中文', description: 'one "idea"', robots: 'index,follow', html: '<main><h1>真实首页正文</h1><a href="/workspace">创作</a></main>' };
describe('prerender document writer', () => {
  it('collects the public catalogue CSS import closure without unrelated editor chunks', () => {
    expect(collectStyles({
      'src/pages/catalogue.tsx': { css: ['assets/catalogue.css'], imports: ['shared'] },
      shared: { css: ['assets/shared.css'] },
      workspace: { css: ['assets/editor.css'] },
    }, ['src/pages/catalogue.tsx'])).toEqual(['assets/catalogue.css', 'assets/shared.css']);
  });
  it('keeps built resource URLs and injects semantic content and escaped metadata', () => {
    const html = renderDocument(template, page);
    expect(html).toContain('<title>ZImage &amp; 中文</title>');
    expect(html).toContain('content="one &quot;idea&quot;"');
    expect(html).toContain('<h1>真实首页正文</h1>');
    expect(html).toContain('/frontend-assets/release/assets/main.js');
    expect(html).toContain('content="index,follow"');
    expect(html).not.toContain('<!--zimage:root-->');
  });
  it.each([template.replace('<!--zimage:root-->', ''), template.replace('<!--zimage:root-->', '<!--zimage:root--><!--zimage:root-->'), template.replace('<title>old</title>', '')])('rejects an unrecognized template instead of writing an empty success page', invalid => {
    expect(() => renderDocument(invalid, page)).toThrow('Invalid prerender template');
  });
});
