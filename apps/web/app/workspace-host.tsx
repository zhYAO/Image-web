'use client';

import { usePathname } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { WorkspaceSidebarProvider } from '@/features/workspace/WorkspaceSidebarBridge';
import { ClientWorkspace } from './client-workspace';
import { useAuthStatus } from '@/features/auth/AuthStatusProvider';
import { catalogueRuntimeAllowed } from '@/features/workspace/catalogue-runtime';

/** Keep one runtime across workspace/history/catalogue navigation. Auth changes destroy it. */
export function WorkspaceHost({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { status, ownerId } = useAuthStatus();
  const active = pathname === '/workspace' || pathname.startsWith('/sessions/') || pathname.startsWith('/create/') || ((pathname === '/create' || pathname === '/assets') && catalogueRuntimeAllowed(status));
  const warm = pathname === '/account' && status === 'authorized';
  const [visited, setVisited] = useState(active || warm);
  if ((active || warm) && !visited) setVisited(true);
  return <WorkspaceSidebarProvider ownerKey={status === 'authorized' ? ownerId : undefined}>
    {(active || (visited && status === 'authorized')) && <div hidden={!active} key={ownerId ?? status}><ClientWorkspace /></div>}
    {/* App Router must mount its outlet to commit navigation, even when the shared runtime paints the page. */}
    <div hidden={active}>{children}</div>
  </WorkspaceSidebarProvider>;
}
