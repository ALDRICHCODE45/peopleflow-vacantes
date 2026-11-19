"use client";
import { useState } from "react";
import { DashboardPageContent } from "@/components/dashboard-page-content";
import { CandidateDashboardOverview } from "@/components/candidate-dashboard/candidate-dashboard-overview";
import { useIdentity } from "@/features/identity/identity-session";
import { DashboardAssessments, type AssessmentResult } from "./assessments";
import { longDate } from "./format";

/** Assessment transport stays in its existing hook; its reader owns loading, error and retry, so the independent
 * profile/CV/application/saved reads survive an assessment retry. */
export function CandidateDashboardWorkspace() {
  const [assessments, setAssessments] = useState<AssessmentResult>();
  const identity = useIdentity();
  const fullName = identity.result?.ok ? identity.result.data.user?.full_name.trim() : undefined;
  // First given name («Hola, Valeria»); the full name only if no first token can be taken.
  const name = fullName?.split(/\s+/u)[0] || fullName;
  return <DashboardPageContent data-pf-candidate-overview width="screen-2xl" container className="flex-1">
    <div className="flex w-full min-w-0 flex-col gap-8 sm:gap-10">
      <header className="flex flex-col gap-1">
        <h2 className="text-2xl font-semibold tracking-tight sm:text-[28px] sm:leading-9">{name ? `Hola, ${name}` : "Tu búsqueda de empleo"}</h2>
        <p className="text-sm text-muted-foreground">{longDate(new Date())}</p>
      </header>
      <div className="flex min-w-0 flex-col gap-3 sm:gap-6">
        <DashboardAssessments onResult={setAssessments} />
        <CandidateDashboardOverview assessments={assessments} />
      </div>
    </div>
  </DashboardPageContent>;
}
