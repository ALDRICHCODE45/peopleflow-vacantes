import * as React from "react";
import { cookies } from "next/headers";

import { EmployerShell } from "@/components/company-dashboard/employer-shell";

/**
 * The shadcn sidebar primitive persists its desktop state in this cookie; the
 * route group reads it on the server so the first paint matches the last choice.
 */
const SIDEBAR_COOKIE_NAME = "sidebar_state";

/**
 * Employer route-group boundary.
 *
 * The `(empresa)` group is invisible in the URL; the literal `empresa` segment
 * lives inside the group, so the real employer routes are `/empresa/...`
 * (mirroring the existing `(auth)/empresa/login` -> `/empresa/login`
 * convention).
 *
 * This layout mounts the one shared employer frame for the whole group, so the
 * routes below it render as content only. Only the exact `sidebar_state` value
 * `false` starts the desktop rail collapsed; absent, malformed or `true` starts
 * expanded.
 */
export default async function EmployerLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const cookieStore = await cookies();
  const defaultOpen = cookieStore.get(SIDEBAR_COOKIE_NAME)?.value !== "false";

  return <EmployerShell defaultOpen={defaultOpen}>{children}</EmployerShell>;
}
