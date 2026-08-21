import type { WorkspaceGateway } from '@zimage/domain';

import { MockWorkspaceGateway } from './mock-workspace-gateway';

let gateway: WorkspaceGateway | undefined;

export function getWorkspaceGateway(): WorkspaceGateway {
  if (gateway) return gateway;
  const mode = process.env.NEXT_PUBLIC_DATA_MODE ?? 'mock';
  if (mode === 'mock') {
    gateway = new MockWorkspaceGateway();
    return gateway;
  }
  throw new Error('HTTP workspace gateway is scheduled for Phase 1B and is not available in Phase 1A.');
}
