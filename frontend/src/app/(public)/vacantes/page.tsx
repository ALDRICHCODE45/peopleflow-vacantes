import * as React from "react";
import { QueryClient } from "@tanstack/react-query";
import { redirect } from "next/navigation";

import { listJobsQueryOptions } from "../../../features/jobs/api/listJobs";
import { JobsNavigationIsland } from "../../../features/jobs/components/JobsNavigationIsland";
import { JobsResults } from "../../../features/jobs/components/JobsResults";
import {
  buildJobsUrl,
  isCanonicalJobsQuery,
  parseJobsQuery,
} from "../../../features/jobs/url";
import type { JobsQuery } from "../../../features/jobs/url";

// The list read is request-scoped: it must run on the Node server on every
// request with live search params, never prerendered or cached.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Flattens Next's scalar-or-repeated search params into raw query text. */
function rawSearchText(
  searchParams: Record<string, string | string[] | undefined>,
): string {
  const raw = new URLSearchParams();
  // Empty and repeated values are preserved verbatim so the canonical
  // comparison sees them and redirects before any query client exists.
  for (const [key, value] of Object.entries(searchParams)) {
    if (typeof value === "string") {
      raw.append(key, value);
    } else if (Array.isArray(value)) {
      for (const entry of value) {
        raw.append(key, entry);
      }
    }
  }
  return raw.toString();
}

export default async function VacantesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const rawQuery = rawSearchText(await searchParams);

  // Canonical redirect before any API access: non-canonical input (unknown
  // keys, invalid enums, repeated values, unsanitized text) is redirected to
  // its canonical URL and `redirect` throws before the query client exists.
  if (!isCanonicalJobsQuery(rawQuery)) {
    redirect(buildJobsUrl(parseJobsQuery(rawQuery)));
  }

  const query: JobsQuery = parseJobsQuery(rawQuery);

  // Fresh request-scoped server client: one `fetchQuery` per render, no
  // provider, no hydration/dehydration, and no client cache crosses requests.
  const queryClient = new QueryClient();
  const result = await queryClient.fetchQuery(listJobsQueryOptions(query));

      return (
        <div className="flex flex-col gap-8">
          <section>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Bolsa de trabajo
            </p>
            <h1 className="mt-3 max-w-2xl font-heading text-4xl font-bold leading-tight tracking-tight text-foreground md:text-5xl">
              Encuentra tu próximo trabajo en tech
            </h1>
            <p className="mt-3 max-w-xl text-base text-muted-foreground">
              Explora vacantes publicadas y filtra por modalidad, senioridad,
              ubicación y moneda.
            </p>
          </section>
          <JobsNavigationIsland
            key={buildJobsUrl(query)}
            routeKey={buildJobsUrl(query)}
            query={query}
          >
            <JobsResults result={result} query={query} />
          </JobsNavigationIsland>
        </div>
      );
}
