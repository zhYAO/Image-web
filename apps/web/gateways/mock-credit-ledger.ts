import {
  TRIAL_CREDIT_CATALOG,
  quoteCredits,
  WorkspaceError,
  type CreditConfirmation,
  type CreditItem,
  type CreditLedger,
  type CreditWallet,
} from "@zimage/domain";
export interface MockCreditState {
  wallet: CreditWallet;
  ledger: CreditLedger["items"];
  operations: Record<
    string,
    {
      hash: string;
      amount: number;
      status: "reserved" | "succeeded" | "refunded";
      model: string;
      operation: string;
      result?: unknown;
    }
  >;
}
export function initialMockCredits(): MockCreditState {
  return {
    wallet: { availableMinor: 1000, frozenMinor: 0, spentMinor: 0 },
    operations: {},
    ledger: [
      {
        id: "1",
        createdAt: new Date().toISOString(),
        kind: "grant",
        amountMinor: 1000,
        operation: null,
        model: null,
        status: null,
        reason: "首次验证账号赠送",
      },
    ],
  };
}
export function checkMockQuote(
  items: CreditItem[],
  confirmation: CreditConfirmation,
) {
  const q = quoteCredits(TRIAL_CREDIT_CATALOG, items);
  if (
    q.version !== confirmation.version ||
    q.totalMinor !== confirmation.totalMinor
  )
    throw new WorkspaceError({
      code: "CONFLICT",
      message: "价格已变化，请重新查看费用后确认。",
      retryable: false,
    });
  return q;
}
function entry(s: MockCreditState, key: string, kind: string) {
  const op = s.operations[key]!;
  s.ledger.unshift({
    id: String(s.ledger.length + 1),
    createdAt: new Date().toISOString(),
    kind,
    amountMinor: op.amount,
    operation: op.operation,
    model: op.model,
    status: op.status,
    reason: null,
  });
}
export function reserveMockCredits(
  s: MockCreditState,
  key: string,
  hash: string,
  item: CreditItem,
) {
  const prior = s.operations[key];
  if (prior) {
    if (prior.hash !== hash)
      throw new WorkspaceError({
        code: "CONFLICT",
        message: "相同请求编号不能用于不同内容。",
        retryable: false,
      });
    return prior;
  }
  const q = quoteCredits(TRIAL_CREDIT_CATALOG, [item]);
  if (s.wallet.availableMinor < q.totalMinor)
    throw new WorkspaceError({
      code: "QUOTA_EXCEEDED",
      message: "可用积分不足，请查看账号积分。",
      retryable: false,
    });
  s.wallet.availableMinor -= q.totalMinor;
  s.wallet.frozenMinor += q.totalMinor;
  s.operations[key] = {
    hash,
    amount: q.totalMinor,
    status: "reserved",
    model: item.model,
    operation: item.operation,
  };
  entry(s, key, "reserve");
  return s.operations[key]!;
}
export function settleMockCredits(
  s: MockCreditState,
  key: string,
  success: boolean,
) {
  const op = s.operations[key];
  if (!op || op.status !== "reserved") return;
  s.wallet.frozenMinor -= op.amount;
  if (success) s.wallet.spentMinor += op.amount;
  else s.wallet.availableMinor += op.amount;
  op.status = success ? "succeeded" : "refunded";
  entry(s, key, success ? "capture" : "release");
}
export function notifyCreditsChanged() {
  if (typeof window !== "undefined")
    window.dispatchEvent(new Event("zimage:credits-changed"));
}
