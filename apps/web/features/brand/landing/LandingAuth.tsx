"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

// Public navigation never imports the editor, its store or the Supabase SDK.
const LandingAuthContext = createContext(false);
export const useLandingAuthorized = () => useContext(LandingAuthContext);
export const WORKSPACE_LOGIN_HREF = "/login?returnTo=%2Fworkspace";

export function LandingAuthProvider({ children }: { children: ReactNode }) {
  const formal = process.env.NEXT_PUBLIC_PHASE2_AUTH === "true";
  const [authorized, setAuthorized] = useState(!formal && process.env.NEXT_PUBLIC_DATA_MODE !== "http");
  useEffect(() => {
    if (!formal) return;
    let version = 0;
    let controller: AbortController | undefined;
    let lastChecked = 0;
    let alive = true;
    const refresh = () => {
      if (!alive || document.hidden || controller) return;
      controller = new AbortController();
      const current = ++version;
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]);
      void fetch("/api/auth/session", { cache: "no-store", signal })
        .then(async (response) => {
          const account = response.ok ? await response.json().catch(() => ({})) : {};
          if (alive && current === version) setAuthorized(response.ok && typeof account.id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(account.id));
        })
        .catch(() => { if (alive && current === version) setAuthorized(false); })
        .finally(() => {
          if (current === version) { controller = undefined; lastChecked = Date.now(); }
        });
    };
    const expire = () => {
      version++;
      controller?.abort();
      controller = undefined;
      setAuthorized(false);
    };
    const changed = (event: Event) => {
      expire();
      if ((event as CustomEvent<boolean>).detail) refresh();
    };
    const visible = () => { if (!document.hidden && Date.now() - lastChecked > 1000) refresh(); };
    // Defer the non-blocking identity lookup until after the first paint.
    const initial = window.setTimeout(refresh, 0);
    window.addEventListener("zimage:auth-required", expire);
    window.addEventListener("zimage:auth-changed", changed);
    window.addEventListener("focus", visible);
    document.addEventListener("visibilitychange", visible);
    return () => {
      alive = false;
      version++;
      window.clearTimeout(initial);
      controller?.abort();
      window.removeEventListener("zimage:auth-required", expire);
      window.removeEventListener("zimage:auth-changed", changed);
      window.removeEventListener("focus", visible);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [formal]);
  return <LandingAuthContext.Provider value={authorized}>{children}</LandingAuthContext.Provider>;
}
