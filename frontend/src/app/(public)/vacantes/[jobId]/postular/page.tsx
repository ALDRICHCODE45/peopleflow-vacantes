import * as React from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { CANDIDATE_IDENTITY, CANDIDATE_PROFILE } from "@/features/candidate/prototype-candidate";
import { VacancyApplicationWizard } from "@/features/jobs/application/vacancy-application-wizard";
import { VacancyApplicationSummary } from "@/features/jobs/application/vacancy-application-summary";

import { VacancyApplicationShell } from "../../../../../features/jobs/application/vacancy-application-shell";
import { enrichJob } from "../../../../../features/jobs/enrich";
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

  // The prototype enrichment is attached here, at the route boundary, so the
  // request-scoped read above stays pure wire data.
  return (
    <VacancyApplicationShell job={enrichJob(result.job)}>
      {/* VAF-03/VAF-06/VAF-07: the four-step wizard owns the local candidate
          draft, the optional local CV and the desktop rail. The vacancy summary
          stays server-composed and is handed down as a slot, so the route ships
          no second data read and the prototype still never implies a submission
          that does not exist. */}
      <VacancyApplicationWizard
        job={enrichJob(result.job)}
        identity={CANDIDATE_IDENTITY}
        profile={CANDIDATE_PROFILE}
        avatarSrc="/candidate/ximena-barrera.jpg"
        vacancySummary={<VacancyApplicationSummary job={enrichJob(result.job)} />}
      />
    </VacancyApplicationShell>
  );
}
