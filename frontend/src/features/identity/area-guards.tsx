"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useIdentity } from "./identity-session";
import { IdentityError, IdentitySkeleton, RoleBlocked } from "./identity-states";

export function CandidateGuard({ children }: { children: React.ReactNode }) {
  const identity = useIdentity();
  const router = useRouter();
  const result = identity.result;
  const destination = identity.status === "unauthenticated" || (result && !result.ok && result.reason === "unauthenticated") ? "/candidato/login" : result?.ok && result.data.role === null ? "/candidato/ingresar" : null;
  React.useEffect(() => { if (destination) router.replace(destination); }, [destination, router]);
  if (identity.status === "loading" || destination) return <IdentitySkeleton />;
  if (!result?.ok) return <IdentityError retry={identity.retry} />;
  if (result.data.role === "recruiter") return <RoleBlocked kind="recruiter" />;
  return <>{children}</>;
}

export function EmployerGuard({ children }: { children: React.ReactNode }) {
  const identity = useIdentity();
  if (identity.status === "loading") return <IdentitySkeleton />;
  // Preserve the existing unauthenticated employer UI and its backend gates,
  // including the local bootstrap flow. This is not API authorization.
  if (identity.status === "unauthenticated") return <>{children}</>;
  const result = identity.result;
  if (!result?.ok) {
    // Additive identity check only: a transient /v2/me outage must not lock an
    // existing recruiter out. Fail open ONLY for no_response/server_error;
    // existing company endpoints still enforce membership server-side.
    if (result?.reason === "unauthenticated") return <>{children}</>; // Existing no-session behavior, not transient fail-open.
    if (result && ["no_response", "server_error"].includes(result.reason)) return <>{children}</>;
    return <IdentityError retry={identity.retry} />;
  }
  if (result.data.role === "candidate") return <RoleBlocked kind="candidate" area="candidate" />;
  if (result.data.role === null) return <RoleBlocked kind="no-company" area="employer" />;
  return <>{children}</>;
}
