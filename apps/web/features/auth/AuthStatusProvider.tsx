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
import { clearWorkspaceAssetCaches } from '@/gateways';
import { z } from 'zod';

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
  const inFlight = useRef<AbortController | null>(null);
  const lastChecked = useRef(0);
  const refresh = useCallback(() => {
    if (!enabled || inFlight.current || document.visibilityState === 'hidden') return;
    const controller = new AbortController();
    inFlight.current = controller;
    const version = ++epoch.current;
    void fetch("/api/auth/session", { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]) })
      .then(async (response) => {
        const account = response.ok ? await response.json().catch(() => ({})) : {};
        if (epoch.current === version) {
          const identity = z.uuid().safeParse(account.id);
          const nextOwner = identity.success ? identity.data : undefined;
          if (verifiedOwner.current && verifiedOwner.current !== nextOwner && (response.ok || response.status === 401)) {
            clearWorkspaceAssetCaches();
            useWorkspaceStore.getState().reset();
            clearCommerceDraft();
          }
          verifiedOwner.current = nextOwner;
          setOwnerId(nextOwner);
          setStatus(
            response.ok && nextOwner
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
        if (inFlight.current === controller) {
          inFlight.current = null;
          lastChecked.current = Date.now();
        }
      });
  }, [enabled]);
  useEffect(() => {
    refresh();
    const expired = () => {
      clearWorkspaceAssetCaches();
      epoch.current++;
      inFlight.current?.abort();
      inFlight.current = null;
      useWorkspaceStore.getState().reset();
      clearCommerceDraft();
      verifiedOwner.current = undefined;
      setOwnerId(undefined);
      setStatus("guest");
    };
    const changed = (event: Event) => {
      clearWorkspaceAssetCaches();
      epoch.current++;
      inFlight.current?.abort();
      inFlight.current = null;
      useWorkspaceStore.getState().reset();
      clearCommerceDraft();
      verifiedOwner.current = undefined;
      setOwnerId(undefined);
      setStatus(
        (event as CustomEvent<boolean>).detail ? "checking" : "guest",
      );
      if ((event as CustomEvent<boolean>).detail) refresh();
    };
    const visible = () => {
      if (document.visibilityState === "visible" && Date.now() - lastChecked.current > 1000) refresh();
    };
    window.addEventListener("zimage:auth-required", expired);
    window.addEventListener("zimage:auth-changed", changed);
    window.addEventListener("focus", visible);
    document.addEventListener("visibilitychange", visible);
    return () => {
      window.removeEventListener("zimage:auth-required", expired);
      window.removeEventListener("zimage:auth-changed", changed);
      window.removeEventListener("focus", visible);
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
