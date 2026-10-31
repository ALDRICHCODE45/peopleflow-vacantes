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
  const name = identity.result?.ok ? identity.result.data.user?.full_name.trim() : undefined;
  return <DashboardPageContent data-pf-candidate-overview width="screen-2xl" container className="flex-1">
    <div className="grid w-full min-w-0 gap-5">
      <DashboardAssessments readerOnly key={attempt} firstVisit={firstVisit} onResult={setAssessments} />
      <CandidateDashboardOverview fullName={name} assessments={{ result: assessments, retry: () => { setAssessments(undefined); setAttempt(value => value + 1); } }} onFirstVisit={setFirstVisit} />
    </div>
  </DashboardPageContent>;
}
