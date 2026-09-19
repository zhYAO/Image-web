import { commerceSubmitSchema, WorkspaceError, type CommerceGateway, type CommerceTask, type CreditConfirmation } from '@zimage/domain';

export interface PendingSubmission { key: string; requestId: string; rejected?: boolean }
export const submissionStorageKey = (taskId: string) => `zimage-commerce-submit:${taskId}`;
export function readPending(storageKey: string): PendingSubmission | undefined {
  try {
    const value = JSON.parse(sessionStorage.getItem(storageKey) ?? 'null');
    if (!value || typeof value.key !== 'string') return;
    commerceSubmitSchema.parse({ ...JSON.parse(value.key), requestId: value.requestId });
    return value;
  } catch { return; }
}
export function persistPending(storageKey: string, request?: PendingSubmission) {
  if (request) sessionStorage.setItem(storageKey, JSON.stringify(request));
  else sessionStorage.removeItem(storageKey);
}
const inFlight = new WeakMap<CommerceGateway, Map<string, Promise<CommerceTask>>>();

/** Initial one-click submission survives page changes and uses the task-card recovery protocol. */
export function submitCommerceOnce(gateway: CommerceGateway, task: CommerceTask, billing?: CreditConfirmation) {
  let requests = inFlight.get(gateway);
  if (!requests) { requests = new Map(); inFlight.set(gateway, requests); }
  const existing = requests.get(task.id);
  if (existing) return existing;
  const key = submissionStorageKey(task.id);
  const saved = readPending(key);
  if (saved && task.runs.some(run => run.requestId === saved.requestId)) {
    persistPending(key);
    return Promise.resolve(task);
  }
  // A refreshed task with a run is already admitted; never turn recovery into recreation.
  if (!saved && task.runs.length) return Promise.resolve(task);
  const payload = saved ? JSON.parse(saved.key) : {
    revision: task.revision, slotIds: task.slots.map(slot => slot.id), recreate: false, source: 'direct', billing,
  };
  const request = saved ?? { key: JSON.stringify(payload), requestId: crypto.randomUUID() };
  persistPending(key, request);
  const promise = gateway.submit(task.id, { ...payload, requestId: request.requestId })
    .then(result => { persistPending(key); return result; })
    .catch(cause => {
      persistPending(key, { ...request, rejected: cause instanceof WorkspaceError && !['NETWORK', 'UNKNOWN', 'PROVIDER_ERROR'].includes(cause.safe.code) });
      throw cause;
    })
    .finally(() => requests.delete(task.id));
  requests.set(task.id, promise);
  return promise;
}
