import type { Metadata } from "next";
import { LoginScreen } from "@/components/auth/LoginScreen";
import { VerifyForm } from "@/components/auth/verify/VerifyForm";

export const metadata: Metadata = {
  title: "Verifica tu correo",
  robots: { index: false, follow: false },
};

/**
 * «Verifica tu correo» for employers (A4.5, step 2 of 3). The email arrives in
 * session storage only, never in the URL; a correct code leads to /empresa/login
 * with the verified notice, and the first sign-in continues to «Tu empresa».
 */
export default function EmployerVerifyPage() {
  return <LoginScreen variant="employer" screen="verify" authControls={<VerifyForm audience="employer" />} />;
}
