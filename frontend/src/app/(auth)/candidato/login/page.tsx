import type { Metadata } from "next";
import { Suspense } from "react";
import { CandidateAuthControls } from "@/components/auth/CandidateAuthControls";

import { LoginScreen } from "@/components/auth/LoginScreen";

export const metadata: Metadata = {
  title: "Ingreso candidatos",
  robots: { index: false, follow: false },
};

export default function CandidateLoginPage() {
  return <LoginScreen variant="candidate" authControls={<Suspense><CandidateAuthControls /></Suspense>} />;
}
