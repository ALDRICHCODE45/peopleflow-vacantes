"use client";

import { useEffect, useState } from "react";
import { loadCompanyStateAction, type CompanyState } from "./actions";
import { useCompanyMembershipState } from "./company-membership-context";

type ExistingCompany = Extract<CompanyState, { kind: "exists" }>;

/** Reuse the authenticated company read; never carry membership across accounts. */
export function useCompanyMembership(userId: string | null): ExistingCompany | null {
  const shared = useCompanyMembershipState();
  // Inside the employer frame the provider already reads it once; elsewhere this hook reads on its own.
  const ownUserId = shared ? null : userId;
  const [loaded, setLoaded] = useState<{ userId: string | null; state: CompanyState | null }>({ userId: ownUserId, state: null });
  // Reset on every identity transition, including sign-out followed by the same
  // account. An effect-only reset could flash a previous membership on render.
  if (loaded.userId !== ownUserId) setLoaded({ userId: ownUserId, state: null });
  useEffect(() => {
    if (ownUserId === null) return;
    let active = true;
    void loadCompanyStateAction().catch((): CompanyState => ({ kind: "no_response", reference: {} })).then(state => {
      if (active) setLoaded({ userId: ownUserId, state });
    });
    return () => { active = false; };
  }, [ownUserId]);

  if (shared) return userId !== null && shared.userId === userId && shared.state?.kind === "exists" ? shared.state : null;
  return userId !== null && loaded.userId === userId && loaded.state?.kind === "exists" ? loaded.state : null;
}
