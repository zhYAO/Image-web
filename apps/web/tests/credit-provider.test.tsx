import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TRIAL_CREDIT_CATALOG, type CreditItem } from '@zimage/domain';
const mocks = vi.hoisted(() => ({ wallet: vi.fn(), confirm: vi.fn(),catalog:vi.fn() }));
vi.mock('@/features/auth/AuthStatusProvider', () => ({ useAuthStatus: () => ({status:'authorized'}) }));
vi.mock('@/gateways', () => ({ getWorkspaceGateway: () => ({getCreditCatalog: async () => mocks.catalog()??TRIAL_CREDIT_CATALOG, getCreditWallet:mocks.wallet}) }));
import { CreditFee, ModelCreditPrice, CreditsProvider, useCredits } from '@/features/credits/CreditsProvider';
const items: CreditItem[] = [{operation:'chat',provider:'doubao',model:'doubao',resolution:'',count:1}];
function Probe() {
  const state = useCredits();
  return <><CreditFee items={items}/><button onClick={() => mocks.confirm(state.confirm(items))}>恢复原请求</button></>;
}
describe('credit confirmation UI', () => {
  beforeEach(() => { mocks.confirm.mockReset();mocks.wallet.mockReset();mocks.catalog.mockReset(); });
  it('shows the low balance warning but lets the server recover an already frozen request', async () => {
    mocks.wallet.mockResolvedValue({availableMinor:0,frozenMinor:2,spentMinor:0});
    render(<CreditsProvider><Probe/></CreditsProvider>);
    await screen.findByRole('link',{name:'查看积分'});
    fireEvent.click(screen.getByRole('button',{name:'恢复原请求'}));
    expect(mocks.confirm).toHaveBeenCalledWith({version:TRIAL_CREDIT_CATALOG.version,totalMinor:2});
    expect(screen.getByText(/本次 0.02 积分/)).toBeVisible();
  });
  it('does not advertise a zero fee when the wallet request fails', async () => {
    mocks.wallet.mockRejectedValue(new Error('offline'));
    render(<CreditsProvider><Probe/></CreditsProvider>);
    expect(await screen.findByText(/积分服务暂不可用/)).toBeVisible();
    expect(screen.queryByText(/0.00/)).not.toBeInTheDocument();
  });
});

it('labels token spending as a versioned cap and shows actual input/output/cache tariffs',async()=>{mocks.wallet.mockResolvedValue({availableMinor:1000,frozenMinor:0,spentMinor:0});mocks.catalog.mockReturnValue({...TRIAL_CREDIT_CATALOG,prices:[{operation:'chat',provider:'doubao',model:'doubao',resolution:'',unitMinor:150,label:'豆包',billingMode:'usage_capped',rateVersion:'synthetic-rate',tokenTariff:{inputPerMillionNano:'28800000000',cachedInputPerMillionNano:'1440000000',outputPerMillionNano:'144000000000',maxInputTokens:32000,maxOutputTokens:4000}}]});render(<CreditsProvider><Probe/><ModelCreditPrice operation="chat" provider="doubao" model="doubao"/></CreditsProvider>);await screen.findByText(/每百万 token：输入 28.8/);expect(screen.queryByText(/1.50 积分\/次/)).toBeNull();fireEvent.click(screen.getByRole('button',{name:'恢复原请求'}));expect(mocks.confirm).toHaveBeenCalledWith({version:TRIAL_CREDIT_CATALOG.version,totalMinor:150,rateVersion:'synthetic-rate'});});
