import type { Metadata } from "next";
import { Suspense } from "react";

import { LoginScreen } from "@/components/auth/LoginScreen";
import { EmployerAuthControls } from "@/components/auth/EmployerAuthControls";
import { resolveSocialProviders } from "@/lib/auth/social";

export const metadata: Metadata = {
  title: "Ingreso empresas",
  robots: { index: false, follow: false },
};

// Social flags are read per request (never frozen at build); an invalid value hides the buttons only.
export const dynamic = "force-dynamic";

// Credentials are entered in this PeopleFlow screen and sent only to our own
// server (NextAuth credentials provider → Cognito USER_PASSWORD_AUTH).
export default function EmployerLoginPage() {
  return <LoginScreen variant="employer" authControls={
    <Suspense fallback={<p role="status" className="mt-8 text-sm text-muted-foreground">Cargando acceso…</p>}>
      <EmployerAuthControls socialProviders={resolveSocialProviders()} />
    </Suspense>
  } />;
}
