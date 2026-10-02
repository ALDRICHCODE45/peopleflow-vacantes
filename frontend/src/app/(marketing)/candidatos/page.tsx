import type { Metadata } from "next";
import "@/components/marketing/reference-landing.css";
import { CandidateFooter, CandidateLanding } from "@/components/marketing/CandidateLanding";
import { ReferenceLandingMotion } from "@/components/marketing/ReferenceLandingMotion";
import { PeopleFlowNavbar } from "@/components/navigation/PeopleFlowNavbar";

export const metadata: Metadata = {
  title: "Tu siguiente paso profesional | PeopleFlow",
  description: "Explora vacantes, conoce a las empresas y da tu siguiente paso profesional con PeopleFlow.",
  alternates: { canonical: "/candidatos" },
};

export default function CandidateMarketingPage() {
  return (
    <div
      data-pf-candidate-landing
      data-pf-reference-landing=""
      className="pf-reference-landing isolate min-h-screen overflow-x-clip bg-base font-sans text-ink antialiased"
    >
      <div className="bg-grid pointer-events-none fixed inset-0 -z-10" />
      <div className="top-glow pointer-events-none fixed inset-x-0 top-0 -z-10 h-[680px]" />
      <a href="#contenido-candidatos" className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:rounded-lg focus:bg-card focus:p-4 focus:text-foreground">Ir al contenido</a>
      <PeopleFlowNavbar mode="candidate-marketing" />
      <main id="contenido-candidatos"><CandidateLanding /></main>
      <CandidateFooter />
      <ReferenceLandingMotion />
    </div>
  );
}
