import * as React from "react";

import { PublicShell } from "../../components/shells/PublicShell";

// Company microsites retain the public chrome; public vacancy routes share
// the candidate app frame in the (candidato) group instead.
export default function PublicLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return <PublicShell>{children}</PublicShell>;
}
