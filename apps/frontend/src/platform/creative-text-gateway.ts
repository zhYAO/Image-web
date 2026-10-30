import type { CreativeTextOptimizeRequest } from '@zimage/domain';
import { HttpWorkspaceGateway } from '../../../web/gateways/http-workspace-gateway';
import { getWorkspaceGateway } from './gateways';

/** Same scoped HTTP/billing contract as the legacy client; no automatic retry. */
export async function requestCreativeTextOptimization(value: CreativeTextOptimizeRequest, signal?: AbortSignal) {
  const gateway = getWorkspaceGateway();
  if (!(gateway instanceof HttpWorkspaceGateway)) throw new Error('HTTP workspace is unavailable');
  const scope = gateway.createOwnerScope(() => !signal?.aborted);
  try { return await scope.gateway.optimizeText(value, signal); }
  finally { scope.dispose(); }
}
