import { describe, expect, it, vi } from 'vitest';
import { captureWorkerException } from '../../../supabase/functions/_shared/observability';
import { reportServerError } from '@/server/observability';

describe('server observability boundary', () => {
  it('keeps worker failure logs free of the original exception', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await captureWorkerException(new Error('private provider token'), {
        operation: 'generation_worker', correlationId: 'safe-correlation-id',
      });
      expect(log).toHaveBeenCalledExactlyOnceWith({
        event: 'worker_operation_failed', operation: 'generation_worker',
        correlation_id: 'safe-correlation-id', job_id: undefined, status: undefined,
      });
      expect(JSON.stringify(log.mock.calls)).not.toContain('private');
    } finally { log.mockRestore(); }
  });
  it('logs safe correlation context without the original exception', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      reportServerError(new Error('token=private prompt=secret'), {
        correlationId: 'safe-correlation-id', operation: 'route_handler',
      });
      expect(log).toHaveBeenCalledExactlyOnceWith({
        event: 'server_operation_failed', correlation_id: 'safe-correlation-id',
        operation: 'route_handler',
      });
      expect(JSON.stringify(log.mock.calls)).not.toContain('private');
      expect(JSON.stringify(log.mock.calls)).not.toContain('secret');
    } finally { log.mockRestore(); }
  });
});
