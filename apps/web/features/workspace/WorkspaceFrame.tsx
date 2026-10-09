import type { ReactNode } from 'react';
import styles from './workspace.module.css';

/** Shared presentation only; the workspace continues to own sessions and drafts. */
export function WorkspaceFrame({ sidebar, header, children, collapsed = false }: {
  sidebar: ReactNode;
  header: ReactNode;
  children: ReactNode;
  collapsed?: boolean;
}) {
  return <div className={`${styles.workspace} ${collapsed ? styles.workspaceCollapsed : ''}`}>
    <aside className={styles.sidebar} aria-label="会话侧栏">{sidebar}</aside>
    <main className={styles.main}>{header}{children}</main>
  </div>;
}
