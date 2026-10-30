/** Only the API-verified formal identity provider may emit authorized. */
export function catalogueRuntimeAllowed(status: string) { return status === 'authorized'; }
