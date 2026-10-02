import * as React from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { JobDetailView } from "../../../../features/jobs/components/JobDetailView";
import { enrichJob } from "../../../../features/jobs/enrich";
import { createVacanteDetailScope } from "./page-data";

// The detail read is request-scoped: it must run on the Node server on every
// request with live route params, never prerendered or cached.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type VacanteDetailPageProps = {
  params: Promise<{ jobId: string }>;
};

/** Maximum plain-text description length emitted in metadata. */
const MAX_DESCRIPTION_LENGTH = 160;

/** Whitespace-collapsed, safely truncated plain-text description. */
function metaDescription(description: string): string {
  const collapsed = description.replace(/\s+/g, " ").trim();
  return collapsed.length > MAX_DESCRIPTION_LENGTH
    ? `${collapsed.slice(0, MAX_DESCRIPTION_LENGTH - 1)}…`
    : collapsed;
}

// React `cache` ties one fresh request-scoped scope to the current server
// render, so `generateMetadata` and the page share one QueryClient and issue
// exactly one detail read per request.
const getDetailScope = React.cache(createVacanteDetailScope);

export async function generateMetadata({
  params,
}: VacanteDetailPageProps): Promise<Metadata> {
  const { jobId } = await params;
  const result = await getDetailScope().metadata(jobId);

  if (result.kind === "found") {
    // Loaded lazily so route collection during offline builds never triggers
    // the eager environment validation.
    const { serverEnv } = await import("../../../../lib/env/server");
    return {
      title: result.job.title,
      description: metaDescription(result.job.description),
      alternates: {
        canonical: new URL(`/vacantes/${jobId}`, serverEnv.siteUrl).toString(),
      },
      robots: { index: true, follow: true },
    };
  }

  // Malformed identifiers and backend 404s render through the framework's
  // not-found document, which Next itself marks `noindex`; emitting robots
  // metadata here would duplicate that tag. Retryable failures hand the
  // response to the route error boundary under the same framework rule.
  return {};
}

export default async function VacanteDetailPage({
  params,
}: VacanteDetailPageProps) {
  const { jobId } = await params;
  const result = await getDetailScope().read(jobId);

  // Malformed UUIDs never reach the API: `getJob` short-circuits them into the
  // same branded not-found outcome as a backend 404.
  if (result.kind === "notFound") {
    notFound();
  }

  // Retryable service/schema failures are never a branded 404: they surface
  // through the route-local retry boundary below.
  if (result.kind === "unavailable") {
    throw new Error("La vacante no pudo cargarse");
  }

  // The prototype enrichment is attached here, at the route boundary: the
  // request-scoped read and the metadata above stay pure wire data, and an
  // unknown vacancy is copied through untouched by `enrichJob`.
  return <JobDetailView job={enrichJob(result.job)} />;
}
