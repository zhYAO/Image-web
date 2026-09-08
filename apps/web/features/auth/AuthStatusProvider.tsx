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

type AuthStatus = "checking" | "authorized" | "guest" | "error";
const AuthStatusContext = createContext<{
  status: AuthStatus;
  refresh: () => void;
}>({ status: "checking", refresh: () => undefined });

/** Shared across client navigations; this is presentation state, APIs still verify every request. */
export function AuthStatusProvider({ children }: { children: ReactNode }) {
  const enabled = process.env.NEXT_PUBLIC_PHASE2_AUTH === "true";
  const [status, setStatus] = useState<AuthStatus>(
    enabled ? "checking" : "authorized",
  );
  const epoch = useRef(0);
  const inFlight = useRef(false);
  const refresh = useCallback(() => {
    if (!enabled || inFlight.current) return;
    inFlight.current = true;
    const version = ++epoch.current;
    void fetch("/api/account", { cache: "no-store" })
      .then((response) => {
        if (epoch.current === version)
          setStatus(
            response.ok
              ? "authorized"
              : response.status === 401
                ? "guest"
                : "error",
          );
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
      setStatus("guest");
    };
    const changed = (event: Event) => {
      epoch.current++;
      setStatus(
        (event as CustomEvent<boolean>).detail ? "authorized" : "guest",
      );
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
    <AuthStatusContext.Provider value={{ status, refresh }}>
      {children}
    </AuthStatusContext.Provider>
  );
}

export const useAuthStatus = () => useContext(AuthStatusContext);
export const notifyAuthChange = (authenticated: boolean) =>
  window.dispatchEvent(
    new CustomEvent("zimage:auth-changed", { detail: authenticated }),
  );
