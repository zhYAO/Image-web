import { WorkspaceError } from "@zimage/domain";
/** Persist only unfinished billed requests. A reload must not invent a new upstream call. */
const key = "zimage:pending-credit-requests:v1";
type Pending = { identity: string; body: string; requestId: string };
function load(): Pending[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(window.sessionStorage.getItem(key) ?? "[]") as Pending[];
  } catch {
    throw new WorkspaceError({
      code: "NETWORK",
      message: "无法保存请求编号，请允许本站会话存储后重试。",
      retryable: false,
    });
  }
}
function save(entries: Pending[]) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(key, JSON.stringify(entries));
  } catch {
    throw new WorkspaceError({
      code: "NETWORK",
      message: "请求记录保存失败，请保留当前页面并查看积分明细。",
      retryable: false,
    });
  }
}
export function retainCreditRequest(
  path: string,
  body: string,
  headerId?: string,
): Pending | undefined {
  const input = JSON.parse(body) as Record<string, unknown>;
  if (!input.billing) return undefined;
  const { requestId: _requestId, billing: _billing, ...content } = input;
  void _requestId;
  void _billing;
  const identity = JSON.stringify({ path, content });
  const entries = load();
  const prior = entries.find((p) => p.identity === identity);
  if (prior) return prior;
  const requestId = headerId ?? String(input.requestId ?? crypto.randomUUID());
  const pending = {
    identity,
    body: JSON.stringify(headerId ? input : { ...input, requestId }),
    requestId,
  };
  save([...entries, pending]);
  return pending;
}
export function completeCreditRequest(pending?: Pending) {
  if (pending) save(load().filter((p) => p.identity !== pending.identity));
}
export function rejectCreditRequest(
  pending: Pending | undefined,
  body: unknown,
) {
  const code = (body as { code?: string })?.code;
  if (
    code &&
    [
      "bad_request",
      "insufficient_credits",
      "price_changed",
      "quota_exceeded",
      "not_found",
      "asset_expired",
      "provider_error",
      "unauthorized",
    ].includes(code)
  )
    completeCreditRequest(pending);
}
