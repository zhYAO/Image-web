'use client';

import { Suspense, type ReactNode } from 'react';
import { AuthStatusProvider } from '@/features/auth/AuthStatusProvider';
import { CreditsProvider } from '@/features/credits/CreditsProvider';
import { AppProviders } from './providers';
import { WorkspaceHost } from './workspace-host';

export function WorkspaceProviders({ children }: { children: ReactNode }) {
  return <AppProviders>
    <AuthStatusProvider>
      <CreditsProvider><Suspense fallback={children}><WorkspaceHost>{children}</WorkspaceHost></Suspense></CreditsProvider>
    </AuthStatusProvider>
  </AppProviders>;
}
