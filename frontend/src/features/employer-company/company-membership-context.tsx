"use client";

import * as React from "react";
import { useIdentity } from "@/features/identity/identity-session";
import { loadCompanyStateAction, type CompanyState } from "./actions";

export type CompanyMembershipValue = {
  /** Employer account whose membership this is; null for visitors and candidates (nothing is read for them). */
  userId: string | null;
  /** null while the read for `userId` is pending. */
  state: CompanyState | null;
  /**
   * Reads the membership again, for example right after accepting a stakeholder invitation. Settles once that read
   * answered (or was superseded), so a caller can wait for it before navigating.
   */
  reload: () => Promise<void>;
};

const CompanyMembershipContext = React.createContext<CompanyMembershipValue | null>(null);

/**
 * One GET /me/company per employer account for the whole employer frame: the sidebar, the stakeholder route gate and
 * the pages read the same membership. It lives below IdentitySessionProvider, so a sign-out or account switch discards it.
 */
export function CompanyMembershipProvider({ children }: { children: React.ReactNode }) {
  const { result } = useIdentity();
  const userId = result?.ok && result.data.role === "recruiter" ? result.data.user?.id ?? null : null;
  const [attempt, setAttempt] = React.useState(0);
  const key = userId === null ? null : `${userId}:${attempt}`;
  const [loaded, setLoaded] = React.useState<{ key: string; state: CompanyState } | null>(null);
  // Callers of reload() waiting for the read their call started; every read settles the waiters of its attempt and before.
  const nextAttempt = React.useRef(0);
  const waiters = React.useRef<{ attempt: number; settle: () => void }[]>([]);
  const settleUpTo = React.useCallback((upTo: number) => {
    const ready = waiters.current.filter(waiter => waiter.attempt <= upTo);
    waiters.current = waiters.current.filter(waiter => waiter.attempt > upTo);
    for (const waiter of ready) waiter.settle();
  }, []);
  React.useEffect(() => {
    // Nothing is read for visitors and candidates: nobody waits on a read that never starts.
    if (key === null) { settleUpTo(Infinity); return; }
    let active = true;
    void loadCompanyStateAction().catch((): CompanyState => ({ kind: "no_response", reference: {} })).then(state => {
      if (active) setLoaded({ key, state });
      settleUpTo(attempt);
    });
    return () => { active = false; };
  }, [key, attempt, settleUpTo]);
  const state = key !== null && loaded?.key === key ? loaded.state : null;
  const reload = React.useCallback(() => new Promise<void>(settle => {
    nextAttempt.current += 1;
    waiters.current.push({ attempt: nextAttempt.current, settle });
    setAttempt(nextAttempt.current);
  }), []);
  const value = React.useMemo(() => ({ userId, state, reload }), [userId, state, reload]);
  return <CompanyMembershipContext.Provider value={value}>{children}</CompanyMembershipContext.Provider>;
}

/** The shared membership, or null outside CompanyMembershipProvider (callers then keep their own behavior). */
export function useCompanyMembershipState(): CompanyMembershipValue | null {
  return React.useContext(CompanyMembershipContext);
}
