import '@/features/brand/identity.css';
import { CreditAccount } from '@/features/credits/CreditsProvider';
import { WebPageShell } from '@/features/shell/WebPageShell';
import { redirect } from 'next/navigation';
import { AccountPanel } from '../../features/account/AccountPanel';
import { createSupabaseServerClient } from '../../lib/supabase/server';
import { readAccount } from '../../server/auth/account-service';
import { ApiRouteError } from '../../server/api-error';

export default async function AccountPage() {
  if(process.env.NEXT_PUBLIC_DATA_MODE==='mock')return <WebPageShell className="account-page"><section className="zi-account"><header className="zi-account-hero"><div className="zi-account-identity"><div><p className="glass-kicker">YOUR CREATIVE SPACE</p><h1>账号</h1><p>模拟预览 · 以下积分仅用于本地演示</p></div></div><a className="zi-button" href="/workspace">返回工作区</a></header><div className="zi-account-grid"><div className="zi-account-main glass-card"><CreditAccount/></div><section className="zi-account-settings glass-card"><h2>个人资料与安全</h2><p className="glass-muted">模拟模式不读取或修改真实账号信息。正式服务模式登录后可管理资料、密码与账号。</p><a href="/login">查看登录入口</a></section></div></section></WebPageShell>;
  let account: Awaited<ReturnType<typeof readAccount>>;
  try {
    account = await readAccount(await createSupabaseServerClient());
  } catch (error) {
    if (error instanceof ApiRouteError && error.status === 401) redirect('/home');
    return <main className="glass-page"><section className="glass-card glass-form account-panel">
      <p className="glass-kicker">ZIMAGE · 账号中心</p>
      <h1>账号服务暂时不可用</h1>
      <p className="glass-muted">暂时无法读取账号信息，请稍后重新加载。</p>
      <nav><a href="/account">重新加载</a><a href="/workspace">返回工作区</a></nav>
    </section></main>;
  }
  return <AccountPanel account={account} />;
}
