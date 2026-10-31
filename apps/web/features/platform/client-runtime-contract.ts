import type { MockScenario, WorkspaceGateway } from '@zimage/domain';

export interface WorkspacePreviewControls {
  getRecoveryNotice(): string | undefined;
  setScenario(scenario: MockScenario): void;
}

/** Platform-owned preview behavior; business UI never imports a mock transport. */
export interface ClientRuntime {
  isMockDataMode(): boolean;
  workspacePreview(gateway: WorkspaceGateway): WorkspacePreviewControls | undefined;
}
