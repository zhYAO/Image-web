let pending: Promise<typeof import('../../../web/features/workspace/WorkspaceApplication')> | undefined;
export function loadWorkspace() {
  pending ??= import('../../../web/features/workspace/WorkspaceApplication').catch(error => { pending = undefined; throw error; });
  return pending;
}
export function prefetchWorkspace() { void loadWorkspace().catch(() => undefined); }
