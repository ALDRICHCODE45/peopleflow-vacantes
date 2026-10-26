"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useIdentity } from "./identity-session";
import { IdentityCheck, IdentityError, IdentitySkeleton, RoleBlocked } from "./identity-states";
import { CandidateOnboarding } from "./onboarding";
import { candidateAuthHref, safeReturnTo } from "./return-to";

export function CandidateEntry() {
  const identity = useIdentity();
  const router = useRouter();
  const params = useSearchParams();
  const next = safeReturnTo(params.get("next"));
  const result = identity.result;
  const destination = identity.status === "unauthenticated" || (result && !result.ok && result.reason === "unauthenticated") ? candidateAuthHref("login", next) : result?.ok && result.data.role === "candidate" ? next ?? "/candidato/dashboard" : null;
  React.useEffect(() => { if (destination) router.replace(destination); }, [destination, router]);
  if (destination) return <IdentityCheck />;
  if (identity.status === "loading") return <IdentitySkeleton />;
  if (!result?.ok) return <IdentityError retry={identity.retry} />;
  if (result.data.role === "recruiter") return <RoleBlocked kind="recruiter" />;
  return <CandidateOnboarding />;
}
