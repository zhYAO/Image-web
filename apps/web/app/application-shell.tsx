'use client';

import dynamic from 'next/dynamic';
import { usePathname } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { WorkspaceLoading } from '@/features/workspace/WorkspaceLoading';

const WorkspaceProviders = dynamic(() => import('./workspace-providers').then(module => module.WorkspaceProviders), {
  loading: () => <WorkspaceLoading />,
});

/** First-time brand visitors need no editor runtime or private service requests. */
export function ApplicationShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const needsRuntime = pathname !== '/' && pathname !== '/home';
  const [entered, setEntered] = useState(needsRuntime);
  if (needsRuntime && !entered) setEntered(true);
  // Once entered, keep the existing provider and workspace tree mounted even on
  // /home so navigation cannot destroy identity, drafts or in-flight UI state.
  if (!entered && !needsRuntime) return children;
  return <WorkspaceProviders>{children}</WorkspaceProviders>;
}
