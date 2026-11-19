import { codeToTokens, createShikiPrimitiveAsync, type HighlighterCore, type HighlighterCoreOptions } from 'shiki/core';

/** Same public Shiki tokenizer, without constructing the unused HTML/HAST methods. */
export async function createTokenHighlighter(options: HighlighterCoreOptions<false>): Promise<Pick<HighlighterCore, 'loadLanguage' | 'codeToTokens' | 'dispose'>> {
  const primitive = await createShikiPrimitiveAsync(options);
  return {
    loadLanguage: primitive.loadLanguage,
    codeToTokens: (code, tokenOptions) => codeToTokens(primitive, code, tokenOptions),
    dispose: primitive.dispose,
  };
}
