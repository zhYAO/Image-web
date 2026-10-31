import { MockWorkspaceGateway } from '@/gateways/mock-workspace-gateway';
import type { ClientRuntime } from './client-runtime-contract';

/** Next keeps its existing environment mode and explicitly supplied mock gateways. */
export const clientRuntime: ClientRuntime = {
  isMockDataMode: () => process.env.NEXT_PUBLIC_DATA_MODE === 'mock',
  workspacePreview: gateway => gateway instanceof MockWorkspaceGateway ? gateway : undefined,
};
