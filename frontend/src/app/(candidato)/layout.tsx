import * as React from "react";
import { cookies } from "next/headers";

import { CandidateShell } from "@/components/candidate-dashboard/candidate-shell";
import { IdentitySessionProvider } from "@/features/identity/identity-session";

/**
 * The shadcn sidebar primitive persists its desktop state in this cookie; the
 * route group reads it on the server so the first paint matches the last choice.
 */
const SIDEBAR_COOKIE_NAME = "sidebar_state";

/**
 * Candidate route-group boundary.
 *
 * The `(candidato)` group is invisible in the URL; the literal `candidato`
 * segment lives inside the group, so the real candidate routes are
 * `/candidato/...` (mirroring the existing `(auth)/candidato/login` ->
 * `/candidato/login` convention).
 *
 * This layout mounts the one shared candidate frame for the whole group, so the
 * routes below it render as content only. Only the exact `sidebar_state` value
 * `false` starts the desktop rail collapsed; absent, malformed or `true` starts
 * expanded. Public vacancies share this frame; only /candidato/* has a client
 * guard in its nested layout. This RSC never resolves identity or reads tokens.
 */
export default async function CandidateLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const cookieStore = await cookies();
  const defaultOpen = cookieStore.get(SIDEBAR_COOKIE_NAME)?.value !== "false";

  return <IdentitySessionProvider><CandidateShell defaultOpen={defaultOpen}>{children}</CandidateShell></IdentitySessionProvider>;
}
