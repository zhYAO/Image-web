import type { ClientRuntime } from '../../../web/features/platform/client-runtime-contract';

/** The independent frontend has one transport: server-owned HTTP. */
export const clientRuntime: ClientRuntime = {
  isMockDataMode: () => false,
  workspacePreview: () => undefined,
};
