import type { WorkspaceGateway } from '@zimage/domain';

import { MockWorkspaceGateway } from './mock-workspace-gateway';
import { HttpWorkspaceGateway } from './http-workspace-gateway';

let gateway: WorkspaceGateway | undefined;

export function clearWorkspaceAssetCaches() {
  if (gateway instanceof HttpWorkspaceGateway) gateway.clearAssetCaches();
}

export function getWorkspaceGateway(): WorkspaceGateway {
  if (gateway) return gateway;
  const mode = process.env.NEXT_PUBLIC_DATA_MODE ?? 'mock';
  if (mode === 'mock') {
    gateway = new MockWorkspaceGateway();
    return gateway;
  }
  if (mode === 'http') {
    gateway = new HttpWorkspaceGateway();
    return gateway;
  }
  throw new Error(`Unsupported NEXT_PUBLIC_DATA_MODE: ${mode}`);
}
