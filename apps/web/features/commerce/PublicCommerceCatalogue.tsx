'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button, Drawer, Space } from 'antd';
import { Menu } from 'lucide-react';
import { useAuthStatus } from '@/features/auth/AuthStatusProvider';
import { useWorkspaceStore } from '@/store/workspace-store';
import { WorkspaceFrame } from '@/features/workspace/WorkspaceFrame';
import { SessionSidebar } from '@/features/workspace/SessionSidebar';
import { catalogueRuntimeAllowed } from '@/features/workspace/catalogue-runtime';
import { CommerceCatalogue } from './CommerceCatalogue';
import styles from '@/features/workspace/workspace.module.css';

export function PublicCommerceCatalogue() {
  const router = useRouter();
  const { status, refresh } = useAuthStatus();
  const { sidebarCollapsed, setSidebarCollapsed, sessionDrawerOpen, setSessionDrawerOpen } = useWorkspaceStore();
  if (catalogueRuntimeAllowed(status)) return null;
  const sidebar = (collapsed = false) => <SessionSidebar sessions={[]} collapsed={collapsed}
    onCollapse={() => setSidebarCollapsed(!collapsed)} onCreate={() => router.push('/')}
    onDelete={() => {}} onRename={() => {}} onSelect={() => {}} />;
  return <WorkspaceFrame collapsed={sidebarCollapsed} sidebar={sidebar(sidebarCollapsed)} header={
    <header className={styles.header}>
      <Space><Button className={styles.mobileControl} aria-label="打开会话" icon={<Menu size={18} />} type="text" onClick={() => setSessionDrawerOpen(true)} /><span className={styles.headerTitle}>电商生图</span></Space>
      {status === 'checking' ? <span>正在确认账号…</span> : <Link href="/login?returnTo=%2Fcreate">登录</Link>}
    </header>
  }>
    {status === 'error' && <div className={styles.statusFeedback} role="alert">身份状态暂不可用 <button onClick={refresh}>重试</button></div>}
    <CommerceCatalogue />
    <Drawer className="workspaceDrawer" title="会话" placement="left" size={320} open={sessionDrawerOpen} onClose={() => setSessionDrawerOpen(false)}>{sidebar()}</Drawer>
  </WorkspaceFrame>;
}
