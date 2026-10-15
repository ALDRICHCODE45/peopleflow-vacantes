import type { Metadata } from "next";
import { Suspense } from "react";

import { LoginScreen } from "@/components/auth/LoginScreen";
import { EmployerAuthControls } from "@/components/auth/EmployerAuthControls";

export const metadata: Metadata = {
  title: "Ingreso empresas",
  robots: { index: false, follow: false },
};

// Credentials are entered only in Cognito managed login, never in this shell.
export default function EmployerLoginPage() {
  return <LoginScreen variant="employer" authControls={
    <Suspense fallback={<p role="status" className="mt-8 text-sm text-muted-foreground">Cargando acceso…</p>}>
      <EmployerAuthControls />
    </Suspense>
  } />;
}
