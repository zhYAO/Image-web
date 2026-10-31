const normalize = (value: string) => value.replaceAll('\\', '/').split('?')[0] ?? '';

/** Audited public UI only; the private runtime is not silently swept into this bridge. */
export function isAllowedClientModule(rawId: string): boolean {
  const id = normalize(rawId);
  if (/(?:^|\/)(?:server-only|sharp|next)(?:\/|$)/.test(id)
    || /\/@sentry\/nextjs(?:\/|$)/.test(id)
    || /\/react-dom\/(?:server|cjs\/react-dom-server)/.test(id)
    || /\.(?:otf|ttf|node)$/i.test(id)) return false;
  if (!id.includes('/apps/web/')) return true;
  // This platform implementation belongs only to Next. The static frontend
  // resolves the explicit interface to its own HTTP implementation.
  if (id.endsWith('/apps/web/features/platform/client-runtime.ts')) return false;
  if (/\/apps\/web\/(?:server|lib|app)\//.test(id)) return id.endsWith('/apps/web/app/globals.css');
  if (/\/apps\/web\/gateways\/mock-/.test(id)) return false;
  return id.includes('/apps/web/features/')
    || id.includes('/apps/web/gateways/')
    || id.includes('/apps/web/store/')
    || id.includes('/apps/web/i18n/')
    || id.endsWith('/apps/web/i18n.ts')
    || id.endsWith('/apps/web/app/globals.css');
}

export function assertClientSource(code: string, id: string) {
  if (!isAllowedClientModule(id)) throw new Error('Unmigrated or server module in frontend graph');
  if (!/\/apps\/(?:frontend\/src|web)\//.test(normalize(id))) return;
  if (/\bprocess\.env\b/.test(code) || /['"](?:node:|server-only|sharp(?:\/|['"]))/.test(code)
    || /['"]next\/(?!link['"]|image['"]|navigation['"]|dynamic['"])/.test(code)) throw new Error('Forbidden server or environment dependency in frontend source');
}
