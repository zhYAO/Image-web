// Shiki 4.4.3 metadata (MIT). Client grammars/themes/engine are not replaced.
import languages from './shiki-language-metadata.json' with { type: 'json' };
import themes from './shiki-theme-metadata.json' with { type: 'json' };

export const bundledLanguagesInfo = languages;
export const bundledThemesInfo = themes;
function unsupportedServerHighlight() {
  throw new Error('Shiki highlighting is client-only; server rendering must use the existing escaped code fallback');
}
export {
  unsupportedServerHighlight as codeToHtml,
  unsupportedServerHighlight as getSingletonHighlighter,
};
