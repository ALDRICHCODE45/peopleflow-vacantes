"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useIdentity } from "./identity-session";
import { IdentityCheck, IdentityError, RoleBlocked } from "./identity-states";

import { CandidateHeader } from "@/components/candidate-dashboard/candidate-header";
import { SiteHeader } from "@/components/company-dashboard/site-header";
import { DashboardPageContent } from "@/components/dashboard-page-content";

function IdentityFrame({ area, children }: { area: "candidate" | "employer"; children: React.ReactNode }) {
  const Header = area === "candidate" ? CandidateHeader : SiteHeader;
  return <>
    <Header title="Tu cuenta" />
    <DashboardPageContent className="flex-1 items-center justify-center">
      <div className="w-full max-w-xl">{children}</div>
    </DashboardPageContent>
  </>;
}

export function CandidateGuard({ children }: { children: React.ReactNode }) {
  const identity = useIdentity();
  const router = useRouter();
  const result = identity.result;
  const destination = identity.status === "unauthenticated" || (result && !result.ok && result.reason === "unauthenticated") ? "/candidato/login" : result?.ok && result.data.role === null ? "/candidato/ingresar" : null;
  React.useEffect(() => { if (destination) router.replace(destination); }, [destination, router]);
  if (identity.status === "loading" || destination) return <IdentityFrame area="candidate"><IdentityCheck /></IdentityFrame>;
  if (!result?.ok) return <IdentityFrame area="candidate"><IdentityError retry={identity.retry} /></IdentityFrame>;
  if (result.data.role === "recruiter") return <IdentityFrame area="candidate"><RoleBlocked kind="recruiter" /></IdentityFrame>;
  return <>{children}</>;
}

export function EmployerGuard({ children }: { children: React.ReactNode }) {
  const identity = useIdentity();
  if (identity.status === "loading") return <IdentityFrame area="employer"><IdentityCheck /></IdentityFrame>;
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
    return <IdentityFrame area="employer"><IdentityError retry={identity.retry} /></IdentityFrame>;
  }
  if (result.data.role === "candidate") return <IdentityFrame area="employer"><RoleBlocked kind="candidate" area="candidate" /></IdentityFrame>;
  if (result.data.role === null) return <IdentityFrame area="employer"><RoleBlocked kind="no-company" area="employer" /></IdentityFrame>;
  return <>{children}</>;
}
