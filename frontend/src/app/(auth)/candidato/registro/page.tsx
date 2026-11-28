import type { Metadata } from "next";
import { LoginScreen } from "@/components/auth/LoginScreen";
import { SignUpForm } from "@/components/auth/sign-up/SignUpForm";

export const metadata: Metadata = {
  title: "Crea tu perfil",
  robots: { index: false, follow: false },
};

/** «Crea tu perfil» (A4.4): the candidate sign-up inside the login shell, FloatingLines kept (L11). */
export default function CandidateSignUpPage() {
  return <LoginScreen variant="candidate" screen="signUp" authControls={<SignUpForm audience="candidate" />} />;
}
