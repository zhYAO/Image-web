import paths from './public-image-paths.json';

const examples = new Set(paths.map(path => '/' + path));

/** Exact public examples only: never rewrite uploads, arbitrary URLs or queries. */
export function isPublicExamplePath(value: string) {
  return examples.has(value);
}

export function publicExampleUrl(value: string, base: string | undefined) {
  return base && isPublicExamplePath(value) ? base + value : value;
}

export function isDirectPublicExample(value: string, base: string | undefined) {
  return Boolean(base && value.startsWith(base) && isPublicExamplePath(value.slice(base.length)));
}
