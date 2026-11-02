import { useState, type ReactNode } from 'react';

export type WorkspaceIdentity = { status: 'checking' | 'authorized' | 'guest' | 'error'; ownerId: string | null };

/** The caller supplies the existing runtime, store and gateways as one subtree. */
export function WorkspaceHost({ active, warm = false, status, ownerId, renderWorkspace, children }: WorkspaceIdentity & {
  active: boolean;
  warm?: boolean;
  renderWorkspace: () => ReactNode;
  children: ReactNode;
}) {
  const authorized = status === 'authorized' && ownerId !== null;
  // Changing identity unmounts all request-transient and draft state together.
  return <>
    <OwnerWorkspaceHost key={authorized ? ownerId : status} active={active} warm={warm} authorized={authorized} renderWorkspace={renderWorkspace} />
    <div hidden={authorized && active}>{children}</div>
  </>;
}

function OwnerWorkspaceHost({ active, warm, authorized, renderWorkspace }: {
  active: boolean; warm: boolean; authorized: boolean; renderWorkspace: () => ReactNode;
}) {
  const [visited, setVisited] = useState((active || warm) && authorized);
  if ((active || warm) && authorized && !visited) setVisited(true);
  return authorized && (active || warm || visited) ? <div hidden={!active}>{renderWorkspace()}</div> : null;
}
