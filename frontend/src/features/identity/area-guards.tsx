"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useIdentity } from "./identity-session";
import { IdentityCheck, IdentityError, RoleBlocked, StakeholderRouteBlocked } from "./identity-states";
import { STAKEHOLDER_HOME, isInvitationRoute, stakeholderRoute } from "./stakeholder-routes";
import { useCompanyMembershipState } from "@/features/employer-company/company-membership-context";
import { candidateAuthHref, safeReturnTo } from "./return-to";

import { CandidateHeader } from "@/components/candidate-dashboard/candidate-header";
import { SiteHeader } from "@/components/company-dashboard/site-header";
import { DashboardPageContent } from "@/components/dashboard-page-content";

function IdentityFrame({ area, title = "Tu cuenta", children }: { area: "candidate" | "employer"; title?: string; children: React.ReactNode }) {
  const Header = area === "candidate" ? CandidateHeader : SiteHeader;
  return <>
    <Header title={title} />
    <DashboardPageContent className="flex-1 items-center justify-center">
      <div className="w-full max-w-xl">{children}</div>
    </DashboardPageContent>
  </>;
}

export function CandidateGuard({ children }: { children: React.ReactNode }) {
  return <React.Suspense fallback={<IdentityFrame area="candidate"><IdentityCheck /></IdentityFrame>}><CandidateGuardContent>{children}</CandidateGuardContent></React.Suspense>;
}

function CandidateGuardContent({ children }: { children: React.ReactNode }) {
  const identity = useIdentity();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const search = params.toString();
  const next = pathname?.startsWith("/candidato/") ? safeReturnTo(`${pathname}${search ? `?${search}` : ""}`) : null;
  const result = identity.result;
  const destination = identity.status === "unauthenticated" || (result && !result.ok && result.reason === "unauthenticated") ? candidateAuthHref("login", next) : result?.ok && result.data.role === null ? candidateAuthHref("ingresar", next) : null;
  React.useEffect(() => { if (destination) router.replace(destination); }, [destination, router]);
  if (identity.status === "loading" || destination) return <IdentityFrame area="candidate"><IdentityCheck /></IdentityFrame>;
  if (!result?.ok) return <IdentityFrame area="candidate"><IdentityError retry={identity.retry} /></IdentityFrame>;
  if (result.data.role === "recruiter") return <IdentityFrame area="candidate"><RoleBlocked kind="recruiter" /></IdentityFrame>;
  return <>{children}</>;
}

export function EmployerGuard({ children }: { children: React.ReactNode }) {
  const identity = useIdentity();
  const router = useRouter();
  const pathname = usePathname();
  const shared = useCompanyMembershipState();
  const result = identity.result;
  // The invitation pages own every state themselves, including «no session» (the token rides in their login link).
  const invitation = isInvitationRoute(pathname);
  // No session: go to the employer login and come back to the requested page.
  const login = !invitation && (identity.status === "unauthenticated" || (result && !result.ok && result.reason === "unauthenticated"))
    ? `/empresa/login?callbackUrl=${encodeURIComponent(pathname ?? "/empresa/dashboard")}` : null;
  // Stakeholder gate (stakeholder-metrics-v1 §1.2): decided before the page mounts, so it never calls the API.
  const employer = result?.ok && result.data.role === "recruiter";
  const membership = shared && employer && shared.userId !== null ? shared.state : undefined;
  const stakeholder = membership?.kind === "exists" && membership.role === "stakeholder" ? stakeholderRoute(pathname) : null;
  const destination = login ?? (stakeholder === "landing" ? STAKEHOLDER_HOME : null);
  React.useEffect(() => { if (destination) router.replace(destination); }, [destination, router]);
  if (invitation) return <>{children}</>;
  if (identity.status === "loading" || destination) return <IdentityFrame area="employer"><IdentityCheck /></IdentityFrame>;
  if (membership === null) return <IdentityFrame area="employer"><IdentityCheck /></IdentityFrame>;
  if (stakeholder === "blocked") return <IdentityFrame area="employer" title="Sección no disponible"><StakeholderRouteBlocked /></IdentityFrame>;
  if (!result?.ok) {
    // Additive identity check only: a transient /v2/me outage must not lock an
    // existing recruiter out. Fail open ONLY for no_response/server_error;
    // existing company endpoints still enforce membership server-side.
    if (result && ["no_response", "server_error"].includes(result.reason)) return <>{children}</>;
    return <IdentityFrame area="employer"><IdentityError retry={identity.retry} /></IdentityFrame>;
  }
  if (result.data.role === "candidate") return <IdentityFrame area="employer"><RoleBlocked kind="candidate" area="candidate" /></IdentityFrame>;
  if (result.data.role === null) return <IdentityFrame area="employer"><RoleBlocked kind="no-company" area="employer" /></IdentityFrame>;
  return <>{children}</>;
}
