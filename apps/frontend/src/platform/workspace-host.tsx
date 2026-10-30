import { useState, type ReactNode } from 'react';

export type WorkspaceIdentity = { status: 'checking' | 'authorized' | 'guest' | 'error'; ownerId: string | null };

/** The caller supplies the existing runtime, store and gateways as one subtree. */
export function WorkspaceHost({ active, status, ownerId, renderWorkspace, children }: WorkspaceIdentity & {
  active: boolean;
  renderWorkspace: () => ReactNode;
  children: ReactNode;
}) {
  const authorized = status === 'authorized' && ownerId !== null;
  // Changing identity unmounts all request-transient and draft state together.
  return <>
    <OwnerWorkspaceHost key={authorized ? ownerId : status} active={active} authorized={authorized} renderWorkspace={renderWorkspace} />
    <div hidden={authorized && active}>{children}</div>
  </>;
}

function OwnerWorkspaceHost({ active, authorized, renderWorkspace }: {
  active: boolean; authorized: boolean; renderWorkspace: () => ReactNode;
}) {
  const [visited, setVisited] = useState(active && authorized);
  if (active && authorized && !visited) setVisited(true);
  return authorized && (active || visited) ? <div hidden={!active}>{renderWorkspace()}</div> : null;
}
