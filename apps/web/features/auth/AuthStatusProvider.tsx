"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useWorkspaceStore } from '@/store/workspace-store';
import { clearCommerceDraft } from '@/features/commerce/commerce-draft-storage';

type AuthStatus = "checking" | "authorized" | "guest" | "error";
const AuthStatusContext = createContext<{
  ownerId?: string;
  status: AuthStatus;
  refresh: () => void;
}>({ status: "checking", refresh: () => undefined });

/** Shared across client navigations; this is presentation state, APIs still verify every request. */
export function AuthStatusProvider({ children }: { children: ReactNode }) {
  const enabled = process.env.NEXT_PUBLIC_PHASE2_AUTH === "true";
  const [status, setStatus] = useState<AuthStatus>(
    enabled ? "checking" : "authorized",
  );
  const [ownerId, setOwnerId] = useState<string | undefined>(enabled ? undefined : 'local');
  const verifiedOwner = useRef<string | undefined>(undefined);
  const epoch = useRef(0);
  const inFlight = useRef(false);
  const refresh = useCallback(() => {
    if (!enabled || inFlight.current) return;
    inFlight.current = true;
    const version = ++epoch.current;
    void fetch("/api/account", { cache: "no-store" })
      .then(async (response) => {
        const account = response.ok ? await response.json().catch(() => ({})) : {};
        if (epoch.current === version) {
          const nextOwner = typeof account.id === 'string' ? account.id : undefined;
          if (verifiedOwner.current && verifiedOwner.current !== nextOwner && (response.ok || response.status === 401)) {
            useWorkspaceStore.getState().reset();
            clearCommerceDraft();
          }
          verifiedOwner.current = nextOwner;
          setOwnerId(nextOwner);
          setStatus(
            response.ok
              ? "authorized"
              : response.status === 401
                ? "guest"
                : "error",
          );
        }
      })
      .catch(() => {
        if (epoch.current === version) setStatus("error");
      })
      .finally(() => {
        inFlight.current = false;
      });
  }, [enabled]);
  useEffect(() => {
    refresh();
    const expired = () => {
      epoch.current++;
      useWorkspaceStore.getState().reset();
      clearCommerceDraft();
      verifiedOwner.current = undefined;
      setOwnerId(undefined);
      setStatus("guest");
    };
    const changed = (event: Event) => {
      epoch.current++;
      useWorkspaceStore.getState().reset();
      clearCommerceDraft();
      verifiedOwner.current = undefined;
      setOwnerId(undefined);
      setStatus(
        (event as CustomEvent<boolean>).detail ? "checking" : "guest",
      );
      if ((event as CustomEvent<boolean>).detail) { inFlight.current = false; refresh(); }
    };
    const visible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    window.addEventListener("zimage:auth-required", expired);
    window.addEventListener("zimage:auth-changed", changed);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", visible);
    return () => {
      window.removeEventListener("zimage:auth-required", expired);
      window.removeEventListener("zimage:auth-changed", changed);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [refresh]);
  return (
    <AuthStatusContext.Provider value={{ status, refresh, ownerId }}>
      {children}
    </AuthStatusContext.Provider>
  );
}

export const useAuthStatus = () => useContext(AuthStatusContext);
export const notifyAuthChange = (authenticated: boolean) =>
  window.dispatchEvent(
    new CustomEvent("zimage:auth-changed", { detail: authenticated }),
  );
