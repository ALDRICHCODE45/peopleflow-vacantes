import type { Metadata } from "next";
import { LoginScreen } from "@/components/auth/LoginScreen";
import { VerifyForm } from "@/components/auth/verify/VerifyForm";

export const metadata: Metadata = {
  title: "Verifica tu correo",
  robots: { index: false, follow: false },
};

/**
 * «Verifica tu correo» (A4.4). The email arrives in session storage only, never
 * in the URL; the form owns the heading because it names that email.
 */
export default function CandidateVerifyPage() {
  return <LoginScreen variant="candidate" screen="verify" authControls={<VerifyForm audience="candidate" />} />;
}
