import { createRequire } from 'node:module';
import { createServer, get, type IncomingMessage, type ServerResponse } from 'node:http';
import { once } from 'node:events';
import { apiErrorSchema } from '@zimage/domain';
import { expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { createAdmissionController } = require('../../../ops/aliyun/backend/http-admission.cjs');

it('real HTTP maintenance responses preserve the frontend network error contract', async () => {
  let entered = 0;
  const controller = createAdmissionController(() => ({ schemaVersion: 2, operationId: 'operation-1', mode: 'draining' }));
  const server = controller.createServer(createServer, undefined, [(_req: IncomingMessage, res: ServerResponse) => { entered++; res.end(); }]);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const response = await new Promise<{ status?: number; headers: IncomingMessage['headers']; body: string }>((resolve, reject) => {
      get({ hostname: '127.0.0.1', port: server.address().port, path: '/api/account', agent: false }, res => {
        let body = '';
        res.setEncoding('utf8'); res.on('data', chunk => { body += chunk; });
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
      }).on('error', reject);
    });
    const error = apiErrorSchema.parse(JSON.parse(response.body));
    expect(error).toMatchObject({ code: 'network', retryable: true, message: '服务正在维护，请保留原请求编号，稍后重试。' });
    expect(response).toMatchObject({ status: 503, headers: { 'cache-control': 'private, no-store', 'retry-after': '30', 'x-correlation-id': error.correlationId } });
    expect(entered).toBe(0);
  } finally { await new Promise<void>(resolve => { server.closeAllConnections(); server.close(resolve); }); }
});
