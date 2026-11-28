import type { Metadata } from "next";
import { Suspense } from "react";
import { CandidateAuthControls } from "@/components/auth/CandidateAuthControls";
import { LoginScreen } from "@/components/auth/LoginScreen";
import { resolveSocialProviders } from "@/lib/auth/social";

export const metadata: Metadata = {
  title: "Ingreso candidatos",
  robots: { index: false, follow: false },
};

// Social flags are read per request (never frozen at build); an invalid value hides the buttons only.
export const dynamic = "force-dynamic";

export default function CandidateLoginPage() {
  return <LoginScreen variant="candidate" authControls={<Suspense><CandidateAuthControls socialProviders={resolveSocialProviders()} /></Suspense>} />;
}
