import { afterEach, describe, expect, it, vi } from 'vitest';
const lifecycle = vi.hoisted(() => ({ start: vi.fn() }));
vi.mock('../server/lifecycle/control-server', () => ({ startLifecycleControl: lifecycle.start }));
import { register } from '../instrumentation';

afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
describe('Node instrumentation lifecycle', () => {
  it('starts and awaits the private lifecycle control', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    let finish!: () => void;
    lifecycle.start.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    let completed = false;
    const result = register().then(() => { completed = true; });
    await Promise.resolve();
    await vi.waitFor(() => expect(lifecycle.start).toHaveBeenCalledOnce());
    expect(completed).toBe(false);
    finish();
    await result;
    expect(completed).toBe(true);
  });
  it('propagates a failed lifecycle check', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    const failure = new Error('synthetic lifecycle rejection');
    lifecycle.start.mockRejectedValueOnce(failure);
    await expect(register()).rejects.toBe(failure);
  });
  it('keeps the Edge runtime free of Node lifecycle startup', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'edge');
    await register();
    expect(lifecycle.start).not.toHaveBeenCalled();
  });
});
