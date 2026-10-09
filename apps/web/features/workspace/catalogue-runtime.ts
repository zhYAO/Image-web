/** The legacy HTTP auth status is synthetic; it must not open a private runtime. */
export function catalogueRuntimeAllowed(status: string) {
  return status === 'authorized' && (process.env.NEXT_PUBLIC_PHASE2_AUTH === 'true' || (process.env.NEXT_PUBLIC_DATA_MODE ?? 'mock') === 'mock');
}
