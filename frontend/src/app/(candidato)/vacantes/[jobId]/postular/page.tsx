import * as React from "react";
import { Briefcase } from "lucide-react";
import { StateCard } from "@/components/feedback/state-card";
import { UnavailableVacancyCard } from "@/features/candidate-applications/unavailable-vacancy";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { CandidateApplicationWizard } from "@/features/candidate-applications/wizard";

import { VacancyApplicationShell } from "../../../../../features/jobs/application/vacancy-application-shell";
import { createVacanteDetailScope } from "../page-data";

// The application read is request-scoped: it must run on the Node server on
// every request with live route params, never prerendered or cached.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type VacanteApplicationPageProps = {
  params: Promise<{ jobId: string }>;
};

// React `cache` ties one fresh request-scoped scope to the current server
// render, so `generateMetadata` and the page share one QueryClient and issue
// exactly one detail read per request.
const getApplicationScope = React.cache(createVacanteDetailScope);

export async function generateMetadata({
  params,
}: VacanteApplicationPageProps): Promise<Metadata> {
  const { jobId } = await params;
  const result = await getApplicationScope().metadata(jobId);

  if (result.kind === "unavailable_vacancy") return { title: result.vacancy.title, robots: { index: false, follow: true } };
  // Legacy rows take no online applications: the page only says so, never indexed.
  if (result.kind === "found" && result.job.source === "legacy") return { title: result.job.title, robots: { index: false, follow: true } };
  if (result.kind === "found") {
    // Loaded lazily so route collection during offline builds never triggers
    // the eager environment validation.
    const { serverEnv } = await import("../../../../../lib/env/server");
    return {
      title: `Postularme · ${result.job.title}`,
      alternates: {
        canonical: new URL(
          `/vacantes/${jobId}/postular`,
          serverEnv.siteUrl,
        ).toString(),
      },
      // The application step is a per-visitor funnel page: it is advertised
      // with a self-referencing canonical and never offered for indexing.
      robots: { index: false, follow: false },
    };
  }

  // Malformed identifiers and backend 404s render through the framework's
  // not-found document, and retryable failures through the route error
  // boundary; both are already `noindex`, so no robots metadata is emitted.
  return {};
}

export default async function VacanteApplicationPage({
  params,
}: VacanteApplicationPageProps) {
  const { jobId } = await params;
  const result = await getApplicationScope().read(jobId);

  // Malformed UUIDs never reach the API: `getJob` short-circuits them into the
  // same branded not-found outcome as a backend 404.
  if (result.kind === "notFound") {
    notFound();
  }

  // Retryable service/schema failures are never a branded 404: they surface
  // through the inherited `[jobId]` route error boundary instead.
  if (result.kind === "unavailable") {
    throw new Error("La postulación no pudo cargarse");
  }

  if (result.kind === "unavailable_vacancy") return <UnavailableVacancyCard vacancy={result.vacancy} headingLevel={1} />;
  if (result.job.source === "vacancy") return <VacancyApplicationShell job={result.job}><CandidateApplicationWizard job={result.job} /></VacancyApplicationShell>;
  // No endpoint accepts a legacy catalog row (POST /v2/jobs/{id}/applications only
  // knows vacancy processes), so a direct link gets an honest state, not a form.
  return <StateCard icon={Briefcase} tone="info" headingLevel={1}
    title="Esta vacante no recibe postulaciones en línea"
    description={<>{result.job.title} · {result.job.company.name}<br />Por ahora no puedes postularte a esta vacante desde PeopleFlow.</>}
    primaryAction={{ label: "Ver otras vacantes", href: "/vacantes" }}
    secondaryAction={{ label: "Volver a la vacante", href: `/vacantes/${jobId}` }} />;
}
