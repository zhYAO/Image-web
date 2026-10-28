'use client';

import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { Archive, ArrowUpRight, Home, Menu, MessageSquare, PanelLeftClose, PanelLeftOpen, ShoppingBag, UserRound } from 'lucide-react';
import { BrandMark } from '@/features/brand/BrandMark';
import { ActionButton, SideDrawer } from '@/features/controls/NativeControls';
import { CreditBalance } from '@/features/credits/CreditsProvider';
import { SidebarTooltip } from '@/features/workspace/SidebarTooltip';
import { WorkspaceFrame } from '@/features/workspace/WorkspaceFrame';
import { useWorkspaceStore } from '@/store/workspace-store';
import styles from '@/features/workspace/workspace.module.css';

const navigation = [
  ['/workspace', '返回工作台', MessageSquare],
  ['/create', '电商创作', ShoppingBag],
  ['/assets', '资产库', Archive],
  ['/account', '账号', UserRound],
] as const;

/** Reference shell geometry with real navigation, without another session store. */
export function AccountFrame({ children }: { children: ReactNode }) {
  const { sidebarCollapsed, setSidebarCollapsed } = useWorkspaceStore();
  const [mobile, setMobile] = useState(false);
  const sidebar = (collapsed: boolean) => <div className={styles.panelInner}>
    <div className={styles.brandRow}>
      {!collapsed && <Link href="/" className={styles.sidebarHeading}><BrandMark /><span>ZImage<span className={styles.brandCaption}>灵感，让创作更自由</span></span></Link>}
      <SidebarTooltip enabled={collapsed} title={collapsed ? '展开导航' : '折叠导航'}>
        <ActionButton variant="text" aria-label={collapsed ? '展开导航' : '折叠导航'} icon={collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />} onClick={() => setSidebarCollapsed(!collapsed)} />
      </SidebarTooltip>
    </div>
    <nav className="account-sidebar-nav" aria-label="创作空间导航">
      {navigation.map(([href, label, Icon]) => <SidebarTooltip key={href} enabled={collapsed} title={label}>
        <Link href={href} aria-label={label} aria-current={href === '/account' ? 'page' : undefined} onClick={() => setMobile(false)}><Icon size={19} />{!collapsed && <span>{label}</span>}</Link>
      </SidebarTooltip>)}
    </nav>
    {!collapsed && <p className="account-sidebar-help">在工作台查看和继续最近的创作会话。</p>}
    <SidebarTooltip enabled={collapsed} title="品牌首页"><Link href="/" aria-label="品牌首页" className="account-home-link"><Home size={17} />{!collapsed && <span>品牌首页</span>}</Link></SidebarTooltip>
  </div>;
  return <WorkspaceFrame collapsed={sidebarCollapsed} sidebar={sidebar(sidebarCollapsed)} header={<header className={styles.header}>
    <div className={styles.headerStart}><ActionButton variant="text" className={styles.mobileControl} aria-label="打开导航" icon={<Menu size={18} />} onClick={() => setMobile(true)} /><span className={styles.headerTitle}>账号</span></div>
    <div className={styles.headerNav}><CreditBalance /><Link href="/workspace">返回工作台 <ArrowUpRight size={14} /></Link></div>
  </header>}>
    {children}
    <SideDrawer className="workspaceDrawer" open={mobile} title="创作空间导航" placement="left" width={268} onClose={() => setMobile(false)}>{sidebar(false)}</SideDrawer>
  </WorkspaceFrame>;
}
