import type { ReactNode } from 'react';
import { Glass } from '@/features/brand/Glass';
import styles from './workspace.module.css';

/** One presentation shell; sessions, drafts and gateway remain in UnifiedWorkspace. */
export function WorkspaceFrame({ sidebar, header, children, collapsed = false, panelLayout = false }: {
  sidebar: ReactNode; header: ReactNode; children: ReactNode; collapsed?: boolean; panelLayout?: boolean;
}) {
  return <div data-workspace-shell="true" className={`${styles.workspace} ${collapsed ? styles.workspaceCollapsed : ''} ${panelLayout ? styles.panelLayout : ''}`}>
    <Glass as="aside" className={styles.sidebar} aria-label="会话侧栏">{sidebar}</Glass>
    <main className={styles.main}>{header}{children}</main>
  </div>;
}
