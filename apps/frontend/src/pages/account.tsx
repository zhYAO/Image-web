import { useEffect } from 'react';
import { useAuthStatus } from '../platform/auth-status';
import { useNavigation } from '../platform/navigation';
import { AccountData, useAccountData } from './account-data';
import { AccountPanel } from './account-panel';

function AccountContent() {
  const data = useAccountData();
  return data.status === 'ready' ? <AccountPanel key={data.account.id} account={data.account} /> : <main className="glass-page"><section className="glass-card glass-form">
    {data.status === 'error' ? <><p role="alert">账号服务暂时不可用，请稍后重试。</p><button type="button" onClick={data.refresh}>重新读取账号</button></> : <p role="status">正在读取账号…</p>}
  </section></main>;
}
export function AccountPage() {
  const { status, ownerId, refresh } = useAuthStatus();
  const navigation = useNavigation();
  useEffect(() => { if (status === 'guest') navigation.replace('/home'); }, [status, navigation]);
  if (status !== 'authorized' || !ownerId) return <main className="glass-page"><p role="status">{status === 'error' ? '暂时无法检查登录状态，请重试。' : '正在确认账号…'}</p>{status === 'error' && <button type="button" onClick={refresh}>重新检查</button>}</main>;
  return <AccountData ownerId={ownerId}><AccountContent /></AccountData>;
}
