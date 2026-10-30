import { apiMetaSchema, publicConfigSchema, type ApiMeta, type PublicConfig } from '@zimage/domain';

export type PublicRuntime = { config: PublicConfig; meta: ApiMeta };
export class RuntimeReadError extends Error {
  constructor(readonly code: 'http_error' | 'invalid_response' | 'network_error', readonly status?: number) {
    super('Public runtime is unavailable');
    this.name = 'RuntimeReadError';
  }
}

/** Only safe GETs. No retry, identity lookup, environment reads or paid request. */
export async function loadPublicRuntime(options: { fetch?: typeof fetch; signal?: AbortSignal } = {}): Promise<PublicRuntime> {
  const request = options.fetch ?? fetch;
  const signal = options.signal
    ? AbortSignal.any([options.signal, AbortSignal.timeout(15_000)])
    : AbortSignal.timeout(15_000);
  const read = async (path: string): Promise<unknown> => {
    try {
      const response = await request(path, { method: 'GET', cache: 'no-store', credentials: 'same-origin', redirect: 'error', signal, headers: { accept: 'application/json' } });
      if (!response.ok) throw new RuntimeReadError('http_error', response.status);
      if (!/^application\/json(?:;|$)/i.test(response.headers.get('content-type') ?? '')) throw new RuntimeReadError('invalid_response');
      return await response.json();
    } catch (error) {
      if (signal.aborted) throw signal.reason;
      if (error instanceof RuntimeReadError) throw error;
      throw new RuntimeReadError('network_error');
    }
  };
  const [rawConfig, rawMeta] = await Promise.all([read('/api/public-config'), read('/api/meta')]);
  const config = publicConfigSchema.safeParse(rawConfig);
  const meta = apiMetaSchema.safeParse(rawMeta);
  if (!config.success || !meta.success) throw new RuntimeReadError('invalid_response');
  return { config: config.data, meta: meta.data };
}
