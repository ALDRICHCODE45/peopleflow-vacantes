import type { Metadata } from "next";
import { LoginScreen } from "@/components/auth/LoginScreen";
import { CompanyStepForm } from "@/components/auth/company/CompanyStepForm";

export const metadata: Metadata = {
  title: "Tu empresa",
  robots: { index: false, follow: false },
};

/**
 * «Tu empresa» (A4.5, step 3 of 3): requires a session (the form sends a
 * visitor to /empresa/login and back), creates the employer account and the
 * company through Server Actions that resolve the token on the server.
 */
export default function EmployerCompanyStepPage() {
  return <LoginScreen variant="employer" screen="company" authControls={<CompanyStepForm />} />;
}
