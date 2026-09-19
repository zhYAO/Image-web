let pending: Promise<typeof import('./WorkspaceApplication')> | undefined;

/** Shares the login prefetch and dynamic renderer's import, including retries. */
export function loadWorkspace() {
  pending ??= import('./WorkspaceApplication').catch(error => {
    pending = undefined;
    throw error;
  });
  return pending;
}

export function prefetchWorkspace() {
  void loadWorkspace().catch(() => undefined);
}
