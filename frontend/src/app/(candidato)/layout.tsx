import * as React from "react";
import { cookies } from "next/headers";

import { CandidateShell } from "@/components/candidate-dashboard/candidate-shell";

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
 * expanded. It owns no auth, session, redirect, fetch or storage concern.
 */
export default async function CandidateLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const cookieStore = await cookies();
  const defaultOpen = cookieStore.get(SIDEBAR_COOKIE_NAME)?.value !== "false";

  return <CandidateShell defaultOpen={defaultOpen}>{children}</CandidateShell>;
}
