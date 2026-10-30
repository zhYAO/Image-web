import ts from 'typescript';
import policy from './public-asset-allowlist.json';

const reviewedModules = [
  '/apps/web/features/brand/landing/HeroGallery.tsx',
  '/apps/web/features/brand/landing/WorkflowReel.tsx',
  '/apps/web/features/commerce/CommerceEditor.tsx',
  '/apps/web/features/commerce/commerce-examples.ts',
];
const catalogue = new Set(policy.files.filter(path => path.startsWith('commerce/')).map(path => '/' + path));

/** Make immutable public URLs part of both bundles, before resource closure checks.
 * Only reviewed source constants are rewritten; dynamic/user/private URLs retain
 * their existing runtime handling. Already versioned inputs remain unchanged.
 */
export function namespacePublicAssetSource(source: string, rawId: string, namespace: string): string {
  const id = rawId.replaceAll('\\', '/').split('?')[0] ?? '';
  if (!namespace || !reviewedModules.some(path => id.endsWith(path))) return source;
  const parsed = ts.createSourceFile(id, source, ts.ScriptTarget.Latest, true, id.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const edits: Array<{ start: number; end: number; value: string }> = [];
  function visit(node: ts.Node) {
    if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && catalogue.has(node.text)) {
      edits.push({ start: node.getStart(parsed), end: node.end, value: JSON.stringify(`/frontend-assets/${namespace}${node.text}`) });
    }
    ts.forEachChild(node, visit);
  }
  visit(parsed);
  let code = source;
  for (const edit of edits.reverse()) code = code.slice(0, edit.start) + edit.value + code.slice(edit.end);
  return code;
}
