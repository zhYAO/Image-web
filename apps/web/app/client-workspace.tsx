'use client';

import dynamic from 'next/dynamic';

import { AnonymousAuthGate } from './anonymous-auth-gate';
import { WorkspaceLoading } from '@/features/workspace/WorkspaceLoading';

const WorkspaceApplication = dynamic(
  () => import('@/features/workspace/WorkspaceApplication').then((module) => module.WorkspaceApplication),
  {
    loading: () => <WorkspaceLoading />,
    ssr: false,
  },
);

export function ClientWorkspace() {
  return (
    <AnonymousAuthGate>
      <WorkspaceApplication />
    </AnonymousAuthGate>
  );
}
