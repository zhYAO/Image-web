import { CreditAccount } from '@/features/credits/CreditsProvider';
import { WebPageShell } from '@/features/shell/WebPageShell';
import { redirect } from 'next/navigation';
import { AccountPanel } from '../../features/account/AccountPanel';
import { createSupabaseServerClient } from '../../lib/supabase/server';
import { readAccount } from '../../server/auth/account-service';
import { ApiRouteError } from '../../server/api-error';

export default async function AccountPage() {
  if(process.env.NEXT_PUBLIC_DATA_MODE==='mock')return <WebPageShell className="account-page"><section className="glass-card glass-form account-panel"><h1>账号</h1><p>模拟预览 · 以下积分仅用于本地演示</p><CreditAccount/></section></WebPageShell>;
  let account: Awaited<ReturnType<typeof readAccount>>;
  try {
    account = await readAccount(await createSupabaseServerClient());
  } catch (error) {
    if (error instanceof ApiRouteError && error.status === 401) redirect('/login?returnTo=/account');
    return <main className="glass-page"><section className="glass-card glass-form account-panel">
      <p className="glass-kicker">ZIMAGE · 账号中心</p>
      <h1>账号服务暂时不可用</h1>
      <p className="glass-muted">暂时无法读取账号信息，请稍后重新加载。</p>
      <nav><a href="/account">重新加载</a><a href="/">返回工作区</a></nav>
    </section></main>;
  }
  return <AccountPanel account={account} />;
}
