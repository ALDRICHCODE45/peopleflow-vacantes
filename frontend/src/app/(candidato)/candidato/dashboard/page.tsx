import type { Metadata } from "next"
import { loadWorkspaceAssessments } from "@/features/psychometrics/workspace/load"
import { PendingAssessments } from "@/features/psychometrics/workspace/assessments"
import { DashboardPageContent } from "@/components/dashboard-page-content"
import { StateCard } from "@/components/feedback/state-card"
import { CircleAlert } from "lucide-react"

import { CandidateDashboardOverview } from "@/components/candidate-dashboard/candidate-dashboard-overview"
import { CandidateHeader } from "@/components/candidate-dashboard/candidate-header"
import { CANDIDATE_IDENTITY, CANDIDATE_PROFILE } from "@/features/candidate/prototype-candidate"
import { CANDIDATE_APPLICATION_MESSAGES } from "@/features/candidate/prototype-messages"
import { CANDIDATE_APPLICATIONS, CANDIDATE_CVS } from "@/features/candidate/prototype-portfolio"

export const metadata: Metadata = {
  title: "Dashboard",
}

/**
 * Candidate dashboard route: the `(candidato)` layout owns the single shell, so
 * this page owns only its header plus the props-only overview. Every metric is
 * derived from the five frozen fixtures. Real assessment tasks are loaded separately
 * and never inserted into those prototype applications or metrics.
 */
export default async function Page() {
  const assessments = await loadWorkspaceAssessments()
  return (
    <>
      <CandidateHeader title="Dashboard" />
      {(!assessments.ok || assessments.data.items.some(item => item.status === "created" || item.status === "in_progress")) && <DashboardPageContent width="screen-2xl">
        {assessments.ok ? <PendingAssessments items={assessments.data.items} /> : <StateCard icon={CircleAlert} tone="error" title="No pudimos cargar las evaluaciones" description="Tus respuestas guardadas se conservan. Consulta de nuevo para revisar tus pendientes." primaryAction={{ label: "Consultar de nuevo", href: "/candidato/dashboard" }} />}
      </DashboardPageContent>}
      <CandidateDashboardOverview
        identity={CANDIDATE_IDENTITY}
        profile={CANDIDATE_PROFILE}
        applications={CANDIDATE_APPLICATIONS}
        cvs={CANDIDATE_CVS}
        messages={CANDIDATE_APPLICATION_MESSAGES}
      />
    </>
  )
}
