'use client';

import { usePathname } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { ClientWorkspace } from './client-workspace';
import { useAuthStatus } from '@/features/auth/AuthStatusProvider';
import { catalogueRuntimeAllowed } from '@/features/workspace/catalogue-runtime';

/** Keep one runtime across workspace/history/catalogue navigation. Auth changes destroy it. */
export function WorkspaceHost({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { status, ownerId } = useAuthStatus();
  const active = pathname === '/workspace' || pathname.startsWith('/sessions/') || pathname.startsWith('/create/') || ((pathname === '/create' || pathname === '/assets') && catalogueRuntimeAllowed(status));
  const [visited, setVisited] = useState(active);
  if (active && !visited) setVisited(true);
  return <>
    {(active || (visited && status === 'authorized')) && <div hidden={!active} key={ownerId ?? status}><ClientWorkspace /></div>}
    {/* App Router must mount its outlet to commit navigation, even when the shared runtime paints the page. */}
    <div hidden={active}>{children}</div>
  </>;
}
