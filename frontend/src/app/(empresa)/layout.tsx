import * as React from "react";

/**
 * Employer route-group boundary.
 *
 * The `(empresa)` group is invisible in the URL; the literal `empresa` segment
 * lives inside the group, so the real employer routes are `/empresa/...`
 * (mirroring the existing `(auth)/empresa/login` -> `/empresa/login`
 * convention).
 *
 * This layout deliberately does not mount a shell: the official shadcn
 * `dashboard-01` block owns its own frame (`SidebarProvider` + `SidebarInset`)
 * inside the dashboard route, so wrapping it here would nest a second
 * provider. The group stays a server component and passes its children
 * straight through.
 */
export default function EmployerLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
