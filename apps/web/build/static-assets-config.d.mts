export function validatePublicAssetBase(raw: string | undefined): string | undefined;
export function publicAssetRemotePatterns(raw: string | undefined): Array<{
  protocol: 'https'; hostname: string; port: string; pathname: string; search: '';
}>;
