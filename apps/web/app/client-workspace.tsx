'use client';

import dynamic from 'next/dynamic';

const WorkspaceApplication = dynamic(
  () => import('@/features/workspace/WorkspaceApplication').then((module) => module.WorkspaceApplication),
  {
    loading: () => (
      <main
        aria-label="ZImage 正在载入"
        style={{ display: 'grid', height: '100dvh', placeItems: 'center' }}
      >
        正在载入 ZImage…
      </main>
    ),
    ssr: false,
  },
);

export function ClientWorkspace() {
  return <WorkspaceApplication />;
}
