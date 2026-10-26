"use client";

import * as React from "react";
import { SessionProvider, useSession } from "next-auth/react";
import { loadMeAction } from "./actions";
import type { Identity, IdentityResult } from "./model";
import { notifyActionResult } from "@/components/feedback/notify";

export type IdentityState = {
  status: "loading" | "unauthenticated" | "ready";
  result?: IdentityResult;
  email: string | null;
  retry: () => void;
  update: (identity: Identity) => void;
};
export const IdentityContext = React.createContext<IdentityState>({ status: "loading", email: null, retry() {}, update() {} });
export function useIdentity() { return React.useContext(IdentityContext); }

function IdentityLoader({ children, session }: { children: React.ReactNode; session: ReturnType<typeof useSession> }) {
  const authenticated = session.status === "authenticated" && !session.data?.error;
  const email = authenticated ? session.data?.user?.email ?? null : null;
  // Invalidate synchronously when the public session changes: never flash the
  // previous account's content while the next effect is still pending.
  const sessionKey = authenticated ? JSON.stringify([email, session.data?.user?.name]) : null;
  const [attempt, setAttempt] = React.useState(0);
  const key = sessionKey === null ? null : `${sessionKey}:${attempt}`;
  const [loaded, setLoaded] = React.useState<{ key: string; result: IdentityResult } | null>(null);
  React.useEffect(() => {
    if (key === null) return;
    let active = true;
    void loadMeAction().catch((): IdentityResult => ({ ok: false, reason: "no_response", reference: {} })).then(result => {
      if (!active) return;
      setLoaded({ key, result });
      // Normal navigation never emits a toast. Only an explicit read retry does.
      if (attempt > 0) notifyActionResult(result.ok
        ? { key: "identity-read", type: "success", title: "Cuenta comprobada", description: "Comprobamos el acceso de tu cuenta. No cambiamos su rol." }
        : { key: "identity-read", type: "error", title: "No pudimos cargar tu cuenta", description: "No confirmamos tu acceso. Puedes reintentar sin crear una cuenta.", reference: { ...result.reference, at: new Date().toISOString() } });
    });
    return () => { active = false; };
  }, [key, attempt]);
  const result = key !== null && loaded?.key === key ? loaded.result : undefined;
  const status = session.status === "loading" ? "loading" : !authenticated ? "unauthenticated" : result ? "ready" : "loading";
  return <IdentityContext.Provider value={{ status, result, email,
    retry: () => setAttempt(value => value + 1),
    update: identity => { if (key !== null) setLoaded({ key, result: { ok: true, data: identity } }); },
  }}>{children}</IdentityContext.Provider>;
}

function SessionIdentityBoundary({ children }: { children: React.ReactNode }) {
  const session = useSession();
  const active = session.status === "authenticated" && !session.data?.error;
  const identity = active ? JSON.stringify([session.data?.user?.email, session.data?.user?.name]) : null;
  // A sign-out, expiration or account switch must discard the previous
  // account's subtree (and its stale requests) even if the next login uses the
  // same email. Resolving the first session (loading -> visitor or first
  // account) has nothing to discard, so public pages keep focus and state.
  const [lifetime, setLifetime] = React.useState({ identity, generation: 0 });
  let current = lifetime;
  if (identity !== lifetime.identity) {
    current = { identity, generation: lifetime.identity === null ? lifetime.generation : lifetime.generation + 1 };
    setLifetime(current);
  }
  return <IdentityLoader key={current.generation} session={session}>{children}</IdentityLoader>;
}

/** The public NextAuth projection has no tokens. All API calls run in actions. */
export function IdentitySessionProvider({ children }: { children: React.ReactNode }) {
  return <SessionProvider refetchInterval={60} refetchOnWindowFocus><SessionIdentityBoundary>{children}</SessionIdentityBoundary></SessionProvider>;
}
