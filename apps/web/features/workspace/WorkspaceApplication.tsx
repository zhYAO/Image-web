'use client';

import { AppProviders } from '@/app/providers';

import { UnifiedWorkspace } from './UnifiedWorkspace';

export function WorkspaceApplication() {
  return (
    <AppProviders>
      <UnifiedWorkspace />
    </AppProviders>
  );
}
