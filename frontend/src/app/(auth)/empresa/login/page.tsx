import type { Metadata } from "next";

import { LoginScreen } from "@/components/auth/LoginScreen";

export const metadata: Metadata = {
  title: "Ingreso empresas",
  robots: { index: false, follow: false },
};

// LOGIN-01 visual-only employer route: shared shell, no auth wiring.
export default function EmployerLoginPage() {
  return <LoginScreen variant="employer" />;
}
