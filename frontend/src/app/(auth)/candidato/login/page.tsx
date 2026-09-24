import type { Metadata } from "next";

import { LoginScreen } from "@/components/auth/LoginScreen";

export const metadata: Metadata = {
  title: "Ingreso candidatos",
  robots: { index: false, follow: false },
};

// LOGIN-01 visual-only candidate route: shared shell, no auth wiring.
export default function CandidateLoginPage() {
  return <LoginScreen variant="candidate" />;
}
