import { describe, expect, it, vi } from 'vitest';
import { reportServerError } from '@/server/observability';

describe('server observability boundary', () => {
  it('logs safe correlation context without the exception, request or user', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const error = Object.assign(new Error('provider echoed a private prompt'), {
      request: { headers: { authorization: 'Bearer secret' }, data: 'private prompt' },
      user: { id: 'private-user-id' },
    });
    try {
      reportServerError(error, {
        correlationId: 'safe-correlation-id', operation: 'route_handler',
      });
      expect(log).toHaveBeenCalledExactlyOnceWith({
        event: 'server_operation_failed', correlation_id: 'safe-correlation-id',
        operation: 'route_handler',
      });
    } finally { log.mockRestore(); }
  });
});
