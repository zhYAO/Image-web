import { WorkspaceSidebarProvider } from '../../web/features/workspace/WorkspaceSidebarBridge';
import { lazy, Suspense, useEffect } from 'react';
import { AuthStatusProvider, useAuthStatus } from './platform/auth-status';
import { WorkspaceHost } from './platform/workspace-host';
import { useNavigation } from './platform/navigation';
import { clearWorkspaceAssetCaches } from './platform/gateways';
import { resetAuthRequiredNotification } from '../../web/gateways/http-workspace-gateway';
import { loadWorkspace } from './platform/load-workspace';
import { useWorkspaceStore } from '../../web/store/workspace-store';
import { clearCommerceDraft } from '../../web/features/commerce/commerce-draft-storage';
import { CreditsProvider, CreditBalance } from '../../web/features/credits/CreditsProvider';
import { WebPageShell } from '../../web/features/shell/WebPageShell';
import { WorkspaceLoading } from '../../web/features/workspace/WorkspaceLoading';
import { VerifyPanel } from '../../web/features/auth/VerifyPanel';
import { ResetPasswordPanel } from '../../web/features/auth/ResetPasswordPanel';
import { CataloguePage } from './pages/catalogue';
import { AuthPage } from './pages/auth';
import { AccountPage } from './pages/account';
import { Routes } from './routes';
import { resolveRoute } from './route-policy';
import { workspaceRoute } from '../../web/features/workspace/workspace-route';
import Link from './platform/link';

const Workspace = lazy(() => loadWorkspace().then(module => ({ default: module.WorkspaceApplication })));
const resetIdentity = () => { clearWorkspaceAssetCaches(); useWorkspaceStore.getState().reset(); clearCommerceDraft(); };
function WorkspaceGate() {
  const { status, refresh } = useAuthStatus();
  const navigation = useNavigation();
  useEffect(() => {
    if (status !== 'guest') return;
    const route = workspaceRoute(navigation.pathname, navigation.searchParams.toString());
    const destination = route.kind === 'commerce'
      ? `/login?${new URLSearchParams({ returnTo: navigation.href })}` : '/home';
    navigation.replace(destination);
  }, [status, navigation]);
  if (status === 'error') return <main className="glass-page"><p role="alert">暂时无法检查登录状态，请重试。</p><button type="button" onClick={refresh}>重新检查</button></main>;
  return <WorkspaceLoading />;
}
function GuestAssets() {
  const { status, refresh } = useAuthStatus();
  return <WebPageShell><section className="glass-card glass-form"><h1>资产库</h1>
    {status === 'checking' ? <p role="status">正在确认账号…</p> : status === 'error' ? <p role="alert">身份状态暂不可用 <button onClick={refresh}>重试</button></p> : <><p>登录后查看自己的会话作品。</p><Link href="/login?returnTo=%2Fassets">登录并查看作品</Link></>}
  </section></WebPageShell>;
}
const pages = { auth: AuthPage, verify: VerifyPanel, reset: ResetPasswordPanel, account: AccountPage, workspace: WorkspaceGate, catalogue: CataloguePage, assets: GuestAssets };
function IdentityWorkspace() {
  const identity = useAuthStatus();
  const navigation = useNavigation();
  const route = resolveRoute(navigation.href);
  useEffect(() => { if (identity.status === 'authorized') resetAuthRequiredNotification(); }, [identity.status]);
  const active = route.kind === 'page' && ['workspace', 'catalogue', 'assets'].includes(route.page);
  return <WorkspaceSidebarProvider ownerKey={identity.status === 'authorized' ? identity.ownerId : undefined}><WorkspaceHost active={active} warm={route.kind === 'page' && route.page === 'account'} ownerId={identity.ownerId ?? null} status={identity.status}
    renderWorkspace={() => <Suspense fallback={<WorkspaceLoading />}><Workspace /></Suspense>}>
    <Routes pages={pages} legalCreditBalance={<CreditBalance />} />
  </WorkspaceHost></WorkspaceSidebarProvider>;
}
export function RuntimeApplication() {
  return <AuthStatusProvider onIdentityReset={resetIdentity}><CreditsProvider><IdentityWorkspace /></CreditsProvider></AuthStatusProvider>;
}
