"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useIdentity } from "./identity-session";
import { IdentityError, IdentitySkeleton, RoleBlocked } from "./identity-states";
import { CandidateOnboarding } from "./onboarding";

export function CandidateEntry() {
  const identity = useIdentity();
  const router = useRouter();
  const result = identity.result;
  const destination = identity.status === "unauthenticated" || (result && !result.ok && result.reason === "unauthenticated") ? "/candidato/login" : result?.ok && result.data.role === "candidate" ? "/candidato/dashboard" : null;
  React.useEffect(() => { if (destination) router.replace(destination); }, [destination, router]);
  if (identity.status === "loading" || destination) return <IdentitySkeleton />;
  if (!result?.ok) return <IdentityError retry={identity.retry} />;
  if (result.data.role === "recruiter") return <RoleBlocked kind="recruiter" />;
  return <CandidateOnboarding />;
}
