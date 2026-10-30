const normalize = (id: string) => id.replaceAll('\\', '/').split('?')[0] ?? '';

function replaceExact(code: string, pattern: string, replacement: string, expected: number) {
  if (code.split(pattern).length - 1 !== expected) throw new Error('Legacy client adapter drift; review the source before building');
  return code.replaceAll(pattern, replacement);
}

/** Small reviewed substitutions while the coordinator owns packages/ui extraction.
 * HTTP is the static frontend's fixed transport, never a selectable mock mode.
 * No environment values or business handlers are injected into the browser.
 */
export function adaptLegacyClientSource(source: string, rawId: string): string {
  const id = normalize(rawId);
  let code = source;
  if (id.endsWith('/apps/web/features/workspace/UnifiedWorkspace.tsx')) {
    code = replaceExact(code, "import { MockWorkspaceGateway } from '@/gateways/mock-workspace-gateway';", '', 1);
    code = replaceExact(code, 'gateway instanceof MockWorkspaceGateway', 'false', 6);
  }
  if (id.endsWith('/apps/web/features/commerce/CommerceTaskCard.tsx')) code = replaceExact(code, "process.env.NEXT_PUBLIC_DATA_MODE === 'mock'", 'false', 2);
  if (id.endsWith('/apps/web/features/commerce/LegacyCreativeBatchHistory.tsx')) code = replaceExact(code, "process.env.NEXT_PUBLIC_DATA_MODE === 'mock'", 'false', 1);
  return code;
}
