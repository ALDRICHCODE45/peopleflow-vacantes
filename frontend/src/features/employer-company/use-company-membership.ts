"use client";

import { useEffect, useState } from "react";
import { loadCompanyStateAction, type CompanyState } from "./actions";

type ExistingCompany = Extract<CompanyState, { kind: "exists" }>;

/** Reuse the authenticated company read; never carry membership across accounts. */
export function useCompanyMembership(userId: string | null): ExistingCompany | null {
  const [loaded, setLoaded] = useState<{ userId: string | null; state: CompanyState | null }>({ userId, state: null });
  // Reset on every identity transition, including sign-out followed by the same
  // account. An effect-only reset could flash a previous membership on render.
  if (loaded.userId !== userId) setLoaded({ userId, state: null });
  useEffect(() => {
    if (userId === null) return;
    let active = true;
    void loadCompanyStateAction().catch((): CompanyState => ({ kind: "no_response", reference: {} })).then(state => {
      if (active) setLoaded({ userId, state });
    });
    return () => { active = false; };
  }, [userId]);

  return userId !== null && loaded.userId === userId && loaded.state?.kind === "exists" ? loaded.state : null;
}
