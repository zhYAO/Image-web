'use client';
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
export type WorkspaceSidebarSnapshot = { ownerKey: string; version: string; feedback?: { message: string }; render: (collapsed: boolean) => ReactNode };
const Context = createContext<{ snapshot?: WorkspaceSidebarSnapshot; publish: (snapshot: WorkspaceSidebarSnapshot) => (() => void) } | null>(null);
/** Read-only presentation of the sole workspace; no gateway, session cache or persistence. */
export function WorkspaceSidebarProvider({ ownerKey, children }: { ownerKey?: string; children: ReactNode }) {
 const [snapshot, setSnapshot] = useState<WorkspaceSidebarSnapshot>();
 const publish = useCallback((next: WorkspaceSidebarSnapshot) => {
  if (!ownerKey || next.ownerKey !== ownerKey) return () => {};
  setSnapshot(current => current?.ownerKey === next.ownerKey && current.version === next.version ? current : next);
  return () => setSnapshot(current => current === next ? undefined : current);
 }, [ownerKey]);
 const visible = snapshot?.ownerKey === ownerKey ? snapshot : undefined;
 const value = useMemo(() => ({ snapshot: visible, publish }), [visible, publish]);
 return <Context.Provider value={value}>{children}</Context.Provider>;
}
export const useWorkspaceSidebarBridge = () => useContext(Context);
export function useAccountWorkspaceSidebar(ownerKey?: string) {
 const context = useContext(Context);
 return ownerKey && context?.snapshot?.ownerKey === ownerKey ? context.snapshot : undefined;
}
