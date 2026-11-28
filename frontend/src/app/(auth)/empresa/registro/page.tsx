import type { Metadata } from "next";
import { LoginScreen } from "@/components/auth/LoginScreen";
import { SignUpForm } from "@/components/auth/sign-up/SignUpForm";

export const metadata: Metadata = {
  title: "Registra tu empresa",
  robots: { index: false, follow: false },
};

/** «Registra tu empresa» · Tu cuenta (A4.5, step 1 of 3): the employer sign-up inside the login shell, FloatingLines kept (L11). */
export default function EmployerSignUpPage() {
  return <LoginScreen variant="employer" screen="signUp" authControls={<SignUpForm audience="employer" />} />;
}
