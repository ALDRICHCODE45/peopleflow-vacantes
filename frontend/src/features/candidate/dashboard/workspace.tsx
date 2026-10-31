"use client";
import { useState } from "react";
import { DashboardPageContent } from "@/components/dashboard-page-content";
import { CandidateDashboardOverview } from "@/components/candidate-dashboard/candidate-dashboard-overview";
import { useIdentity } from "@/features/identity/identity-session";
import { DashboardAssessments, type AssessmentResult } from "./assessments";

/** Assessment transport stays in its existing hook. Remount only that reader
 * on explicit retry, so the independent profile/CV/application reads survive. */
export function CandidateDashboardWorkspace() {
  const [assessments, setAssessments] = useState<AssessmentResult>();
  const [attempt, setAttempt] = useState(0);
  const [firstVisit, setFirstVisit] = useState(false);
  const identity = useIdentity();
  const name = identity.result?.ok ? identity.result.data.user?.full_name.trim().split(/\s+/u)[0] : undefined;
  return <DashboardPageContent data-pf-candidate-overview width="screen-2xl" container className="flex-1">
    <div className="grid w-full min-w-0 grid-cols-1 items-start gap-7 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] lg:gap-8">
      <CandidateDashboardOverview firstName={name} assessments={{ result: assessments, retry: () => { setAssessments(undefined); setAttempt(value => value + 1); } }} onFirstVisit={setFirstVisit} />
      <DashboardAssessments key={attempt} firstVisit={firstVisit} onResult={setAssessments} />
      <p className="order-5 text-xs text-muted-foreground lg:order-none lg:col-span-2">Bitácora personal · Sigue lo que cambió, sin confundirlo con las etapas internas de la empresa.</p>
    </div>
  </DashboardPageContent>;
}
