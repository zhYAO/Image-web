import { describe, expect, it } from 'vitest';
import { workspaceRoute } from '@/features/workspace/workspace-route';
import { normalizeReturnTo } from '@/server/auth/redirects';

describe('workspace entry migration', () => {
  it('gives the blank workspace its own route while retaining legacy root scene intents', () => {
    expect(workspaceRoute('/workspace')).toEqual({ kind: 'home' });
    expect(workspaceRoute('/')).toEqual({ kind: 'outside' });
    expect(workspaceRoute('/', 'scene=product-set')).toMatchObject({ kind: 'commerce', scene: 'product-set' });
    expect(workspaceRoute('/sessions/session-1', 'task=task-1&batch=batch-1&view=results')).toEqual({ kind:'session', sessionId:'session-1', taskId:'task-1', batchId:'batch-1', view:'results' });
  });
  it('defaults safe login and verification returns to the workspace', () => {
    expect(normalizeReturnTo(undefined)).toBe('/workspace');
    expect(normalizeReturnTo('//outside.test')).toBe('/workspace');
    expect(normalizeReturnTo('/api')).toBe('/workspace');
    expect(normalizeReturnTo('/auth')).toBe('/workspace');
    expect(normalizeReturnTo('/sessions/s1?task=t1')).toBe('/sessions/s1?task=t1');
  });
});
