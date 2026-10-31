import type { WorkspaceGateway } from '@zimage/domain';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { clientRuntime } from '@/features/platform/client-runtime';

afterEach(() => vi.unstubAllEnvs());

describe('static frontend platform boundary', () => {
  it.each(['mock', 'http', undefined])('keeps HTTP mode independent of the old Next flag %s', mode => {
    vi.stubEnv('NEXT_PUBLIC_DATA_MODE', mode);
    expect(clientRuntime.isMockDataMode()).toBe(false);
  });
  it('never exposes preview controls even when a supplied gateway has matching methods', () => {
    const gateway = { getRecoveryNotice: vi.fn(), setScenario: vi.fn() };
    expect(clientRuntime.workspacePreview(gateway as unknown as WorkspaceGateway)).toBeUndefined();
    expect(gateway.getRecoveryNotice).not.toHaveBeenCalled();
    expect(gateway.setScenario).not.toHaveBeenCalled();
  });
});
