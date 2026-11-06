"use client";

import { CommercePackageRecoveryList } from '@/features/commerce/CommercePackageRecoveryList';
import { clientRuntime } from '@/features/platform/client-runtime';
import { Glass } from "@/features/brand/Glass";
import { ContentDialog } from '@/features/controls/NativeControls';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import Link from "next/link";

import { Coins } from "lucide-react";
import {
  formatCredits,
  quoteCredits,
  type CreditCatalog,
  type CreditConfirmation,
  type CreditItem,
  type CreditLedger,
  type CreditWallet,
} from "@zimage/domain";
import { getWorkspaceGateway } from "@/gateways";
import { useAuthStatus } from "@/features/auth/AuthStatusProvider";

type CreditState = {
  present: boolean;
  catalog?: CreditCatalog;
  wallet?: CreditWallet;
  error?: string;
  refresh: () => void;
  confirm: (items: CreditItem[]) => CreditConfirmation | undefined;
  remember: (taskId: string, quote?: CreditConfirmation) => void;
  recalled: (taskId: string) => CreditConfirmation | undefined;
};
const Context = createContext<CreditState>({
  present: false,
  refresh: () => {},
  confirm: () => undefined,
  remember: () => {},
  recalled: () => undefined,
});
export const useCredits = () => useContext(Context);
export function CreditsProvider({ children }: { children: ReactNode }) {
  const { status, ownerId } = useAuthStatus();
  return <OwnerCreditsProvider key={status === 'authorized' ? ownerId ?? 'local' : 'guest'}>{children}</OwnerCreditsProvider>;
}
function OwnerCreditsProvider({ children }: { children: ReactNode }) {
  const { status } = useAuthStatus();
  const [catalog, setCatalog] = useState<CreditCatalog>();
  const [wallet, setWallet] = useState<CreditWallet>();
  const [error, setError] = useState<string>();
  const saved = useRef(new Map<string, CreditConfirmation>());
  const epoch = useRef(0);
  const inFlight = useRef(false);
  const invalidated = useRef(false);
  const lastChecked = useRef(0);
  const refreshRef = useRef<() => void>(() => {});
  const refresh = useCallback(() => {
    if (inFlight.current || document.visibilityState === 'hidden') {
      invalidated.current = true;
      return;
    }
    invalidated.current = false;
    const current = ++epoch.current;
    if (status !== "authorized") {
      setWallet(undefined);
      setCatalog(undefined);
      return;
    }
    const gateway = getWorkspaceGateway();
    if (!gateway.getCreditCatalog || !gateway.getCreditWallet) return;
    inFlight.current = true;
    void Promise.allSettled([
      gateway.getCreditCatalog(),
      gateway.getCreditWallet(),
    ]).then(([prices, balance]) => {
      if (epoch.current !== current) return;
      setCatalog(prices.status === "fulfilled" ? prices.value : undefined);
      setWallet(balance.status === "fulfilled" ? balance.value : undefined);
      setError(
        prices.status === "rejected" || balance.status === "rejected"
          ? "积分服务暂不可用，请稍后刷新。"
          : undefined,
      );
    }).finally(() => {
      if (epoch.current !== current) return;
      inFlight.current = false;
      lastChecked.current = Date.now();
      if (invalidated.current) refreshRef.current();
    });
  }, [status]);
  useEffect(() => { refreshRef.current = refresh; }, [refresh]);
  useEffect(() => {
    let active = true;
    const requestEpoch = epoch;
    void Promise.resolve().then(() => {
      if (active) refresh();
    });
    const changed = () => refresh();
    const visible = () => {
      if (document.visibilityState === 'visible' && (invalidated.current || Date.now() - lastChecked.current > 1000)) refresh();
    };
    window.addEventListener("zimage:credits-changed", changed);
    window.addEventListener("focus", visible);
    document.addEventListener('visibilitychange', visible);
    const timer = window.setInterval(visible, 300_000);
    return () => {
      active = false;
      window.clearInterval(timer);
      requestEpoch.current++;
      inFlight.current = false;
      window.removeEventListener("zimage:credits-changed", changed);
      window.removeEventListener("focus", visible);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [refresh]);
  const confirm = useCallback(
    (items: CreditItem[]) => {
      if (catalog?.enabled === false) return undefined;
      if (error || !catalog || !wallet)
        throw new Error(error ?? "正在获取积分报价，请稍后再试。");
      const quote = quoteCredits(catalog, items);
      // The server checks new spending atomically. A retry may already own a
      // reservation, so low available balance must not prevent its recovery.
      return { version: quote.version, totalMinor: quote.totalMinor, ...(quote.rateVersion?{rateVersion:quote.rateVersion}:{}) };
    },
    [catalog, wallet, error],
  );
  return (
    <Context.Provider
      value={{
        present: true,
        catalog: status === "authorized" ? catalog : undefined,
        wallet: status === "authorized" ? wallet : undefined,
        error,
        refresh,
        confirm,
        remember: (id, quote) => {
          if (quote) saved.current.set(id, quote);
        },
        recalled: (id) => saved.current.get(id),
      }}
    >
      {children}
    </Context.Provider>
  );
}
export function CreditFee({ items }: { items: CreditItem[] }) {
  const state = useCredits();
  if (!state.present) return null;
  if (state.catalog?.enabled === false)
    return <small className="credit-fee">积分计费尚未启用</small>;
  if (state.error || !state.catalog || !state.wallet)
    return (
      <small className="credit-fee">
        {state.error ?? "正在获取积分报价…"}{" "}
        <button type="button" onClick={state.refresh}>
          刷新
        </button>
      </small>
    );
  let quote;
  try {
    quote = quoteCredits(state.catalog, items);
  } catch {}
  if (!quote) return <small className="credit-fee">所选模型报价暂不可用</small>;
  return (
    <small className="credit-fee">
      {items[0]?.operation==='chat'&&quote.rateVersion?'最高冻结':'本次'} {formatCredits(quote.totalMinor)} 积分
      {items[0]?.operation==='chat'&&quote.rateVersion&&<span> · 按实际输入/输出 token 结算，多余退回；停止后可核实用量照常结算，未知用量待核对。</span>}
      {quote.totalMinor > state.wallet.availableMinor && (
        <>
          {" "}
          · 积分不足，<Link href="/account">查看积分</Link>
        </>
      )}
    </small>
  );
}
function priceLabel(p:CreditCatalog['prices'][number]){
  if(p.billingMode==='usage_capped'){
    const amount=(v:string)=>new Intl.NumberFormat('zh-CN',{maximumFractionDigits:6}).format(Number(v)/1000000000),t=p.tokenTariff;
    return `最高冻结 ${formatCredits(p.unitMinor)} 积分${t?` · 每百万 token：输入 ${amount(t.inputPerMillionNano)} / 缓存输入 ${amount(t.cachedInputPerMillionNano)}${t.cacheWritePerMillionNano?` / 缓存写入 ${amount(t.cacheWritePerMillionNano)}`:''} / 输出 ${amount(t.outputPerMillionNano)} 积分${t.serviceTier==='default'?` · 标准档${t.cacheTtl==='30m'?' · 缓存30分钟':''}`:''}`:''}`;
  }
  return `${p.resolution?`${p.resolution} · `:''}${formatCredits(p.unitMinor)} 积分/${p.operation==='image'?'张':'次'}`;
}
export function ModelCreditPrice({
  operation,
  provider,
  model,
  resolution,
}: {
  operation: CreditItem["operation"];
  provider: string;
  model: string;
  resolution?: string;
}) {
  const { catalog } = useCredits();
  if (!catalog?.enabled) return null;
  const prices = catalog.prices.filter(
    (p) =>
      p.operation === operation &&
      p.provider === provider &&
      p.model === model &&
      (!resolution || p.resolution === resolution),
  );
  return (
    <small className="credit-fee">
      {prices.length
        ? prices
            .map(
              (p) =>
                priceLabel(p),
            )
            .join(" / ")
        : "暂无报价"}
    </small>
  );
}
function Prices() {
  const { catalog } = useCredits();
  return (
    <>
      <p>项目试行价。预览与保存方案免费；成功的文字优化即使撤销也会计费。</p>
      <table className="credit-table">
        <thead>
          <tr>
            <th>模型 / 用途</th>
            <th>积分</th>
          </tr>
        </thead>
        <tbody>
          {catalog?.prices.map((p) => (
            <tr key={`${p.operation}:${p.model}:${p.resolution}`}>
              <td>
                {p.label} ·{" "}
                {p.resolution || (p.operation === "chat" ? "聊天" : "文字优化")}
              </td>
              <td>
                {priceLabel(p)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>
        提交时冻结，成功后结算，明确失败退回。结果未知时保持冻结，等待核对。每日图片张数额度另行计算。
      </p>
    </>
  );
}
export function CreditBalance() {
  const state = useCredits();
  const [open, setOpen] = useState(false);
  if (!state.present) return null;
  return (
    <>
      <button
        type="button"
        className="credit-balance"
        onClick={() => setOpen(true)}
        aria-label="查看积分与模型价格"
      >
        <Coins size={16} aria-hidden />
        {state.wallet
          ? `${formatCredits(state.wallet.availableMinor)} 积分`
          : "积分详情"}
      </button>
      <ContentDialog
        open={open}
        title="我的积分与模型价格"
        footer={null}
        onClose={() => setOpen(false)}
      >
        <p>
          可用 {state.wallet ? formatCredits(state.wallet.availableMinor) : "—"}{" "}
          · 冻结 {state.wallet ? formatCredits(state.wallet.frozenMinor) : "—"}{" "}
          积分
        </p>
        {state.error && <p role="alert">{state.error}</p>}
        <Prices />
        <Link href="/account">查看积分流水</Link>
      </ContentDialog>
    </>
  );
}
export function CreditAccount() {
  const state = useCredits();
  const [ledger, setLedger] = useState<CreditLedger>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async (cursor?: string) => {
    setBusy(true);
    try {
      const data = await getWorkspaceGateway().getCreditLedger?.(cursor);
      if (data)
        setLedger((old) => {
          if (cursor) return { ...data, items: [...(old?.items ?? []), ...data.items] };
          // A balance refresh must not collapse pages the user is reading.
          if (old && old.items.length > data.items.length) {
            const freshIds = new Set(data.items.map(item => item.id));
            return { ...data, items: [...data.items, ...old.items.filter(item => !freshIds.has(item.id))], nextCursor: old.nextCursor };
          }
          return data;
        });
      setError("");
    } catch {
      setError("积分流水加载失败，请重试。");
    } finally {
      setBusy(false);
    }
  }, []);
  useEffect(() => {
    if (state.wallet) void Promise.resolve().then(() => load());
  }, [state.wallet, load]);
  if (!state.present) return null;
  const labels: Record<string, string> = {
    grant: "赠送",
    reserve: "冻结",
    capture: "消费",
    release: "退回",
    review: "待核对",
  };
  return (
    <section aria-label="积分账户" className="zi-credit-account">
      {!clientRuntime.isMockDataMode()&&<CommercePackageRecoveryList/>}
      <Glass as="section" className="zi-account-card" aria-labelledby="zi-credit-title">
        <div className="zi-card-heading"><h2 id="zi-credit-title">我的积分</h2><span>创作消耗，一目了然</span></div>
        <div className="zi-credit-overview">
          <div><span>可用积分</span><strong>{state.wallet ? formatCredits(state.wallet.availableMinor) : "—"}<small>CREDITS</small></strong></div>
          <div className="zi-credit-emblem" aria-hidden="true"><Coins /></div>
        </div>
        <div className="zi-balance-grid">
          <div><span>冻结积分</span><strong>{state.wallet ? formatCredits(state.wallet.frozenMinor) : "—"}</strong></div>
          <div><span>累计消费</span><strong>{state.wallet ? formatCredits(state.wallet.spentMinor) : "—"}</strong></div>
        </div>
        <details className="zi-details"><summary>模型价格与计费说明</summary><Prices /></details>
        <p className="zi-local-note">验证账号一次性获赠 10.00 积分，非每日重置。</p>
        {state.error && <p className="zi-feedback" role="alert">{state.error}</p>}
      </Glass>
      <Glass as="section" className="zi-account-card" aria-labelledby="zi-ledger-title">
        <div className="zi-card-heading"><h2 id="zi-ledger-title">积分流水</h2><span>创作记录</span></div>
        {error && <p className="zi-feedback" role="alert">{error} <button className="zi-text-button" type="button" onClick={() => void load()}>重试</button></p>}
        <div className="zi-table-wrap">
          <table className="zi-ledger">
            <caption className="sr-only">积分流水</caption>
            <thead><tr><th scope="col">时间 / 用途</th><th scope="col">类型</th><th scope="col">积分</th></tr></thead>
            <tbody>
              {ledger?.items.map((row) => (
                <tr key={row.id}>
                  <td><strong>{row.model ?? row.reason ?? "账号操作"}</strong><small>{new Date(row.createdAt).toLocaleString("zh-CN")}</small></td>
                  <td><span className="zi-ledger-type">{labels[row.kind] ?? row.kind}{row.status === "needs_review" ? " · 待核对" : ""}</span></td>
                  <td className={row.kind === "grant" || row.kind === "release" ? "zi-credit-return" : undefined}>{formatCredits(row.amountMinor)}</td>
                </tr>
              ))}
              {ledger?.items.length === 0 && <tr><td colSpan={3}>暂无积分流水。</td></tr>}
            </tbody>
          </table>
        </div>
        {ledger?.nextCursor && <button className="zi-button zi-secondary" type="button" disabled={busy} onClick={() => void load(ledger.nextCursor!)}>加载更多</button>}
      </Glass>
    </section>
  );
}
