import type { Metadata } from "next";
import { LoginScreen } from "@/components/auth/LoginScreen";
import { ForgotPasswordForm } from "@/components/auth/forgot-password/ForgotPasswordForm";

export const metadata: Metadata = {
  title: "Restablece tu contraseña",
  robots: { index: false, follow: false },
};

/**
 * «¿Olvidaste tu contraseña?» for candidates (A4.6): email → code and new
 * password → /candidato/login with «Tu contraseña se actualizó.». The email
 * never travels in the URL; the form owns heading and footer (they change per step).
 */
export default function CandidateRecoverPage() {
  return <LoginScreen variant="candidate" screen="recover" authControls={<ForgotPasswordForm audience="candidate" />} />;
}
