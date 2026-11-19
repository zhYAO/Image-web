// Literal subpath imports keep the full Shiki registry out of both build graphs.
// Unsupported fences retain their complete escaped, copyable text.
const loaders = {
  javascript: () => import('shiki/langs/javascript.mjs'),
  typescript: () => import('shiki/langs/typescript.mjs'),
  jsx: () => import('shiki/langs/jsx.mjs'),
  tsx: () => import('shiki/langs/tsx.mjs'),
  json: () => import('shiki/langs/json.mjs'),
  html: () => import('shiki/langs/html.mjs'),
  css: () => import('shiki/langs/css.mjs'),
  python: () => import('shiki/langs/python.mjs'),
  shellscript: () => import('shiki/langs/shellscript.mjs'),
  sql: () => import('shiki/langs/sql.mjs'),
  markdown: () => import('shiki/langs/markdown.mjs'),
  yaml: () => import('shiki/langs/yaml.mjs'),
  rust: () => import('shiki/langs/rust.mjs'),
  java: () => import('shiki/langs/java.mjs'),
} as const;

type Language = keyof typeof loaders;
const aliases = new Map<string, Language>([
  ...Object.keys(loaders).map(name => [name, name as Language] as const),
  ['js', 'javascript'], ['mjs', 'javascript'], ['cjs', 'javascript'],
  ['ts', 'typescript'], ['py', 'python'], ['bash', 'shellscript'],
  ['sh', 'shellscript'], ['shell', 'shellscript'], ['zsh', 'shellscript'],
  ['md', 'markdown'], ['yml', 'yaml'], ['rs', 'rust'],
]);

export function codeGrammar(label: string) {
  const language = aliases.get(label.toLowerCase());
  return language ? { language, load: loaders[language] } : undefined;
}
