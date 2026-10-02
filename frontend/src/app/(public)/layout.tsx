import * as React from "react";

import { PublicShell } from "../../components/shells/PublicShell";

// Shared shell for the public route group: header, main, and
// footer wrap every public vacancy route without touching the marketing page.
export default function PublicLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return <PublicShell>{children}</PublicShell>;
}
