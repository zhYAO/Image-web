'use client';

import dynamic from 'next/dynamic';
import { loadWorkspace } from '@/features/workspace/load-workspace';

import { AnonymousAuthGate } from './anonymous-auth-gate';
import { WorkspaceLoading } from '@/features/workspace/WorkspaceLoading';

const WorkspaceApplication = dynamic(
  () => loadWorkspace().then((module) => module.WorkspaceApplication),
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
