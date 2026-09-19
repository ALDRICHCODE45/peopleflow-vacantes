import * as React from "react";
import Link from "next/link";
import { SearchXIcon } from "lucide-react";

import { Button } from "../../../components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "../../../components/ui/empty";
import { findCompanyProfile } from "../../company-profile/model";
import { PROTOTYPE_COMPANY_PROFILES } from "../../company-profile/prototype-companies";
import { listJobs } from "../api/listJobs";
import { enrichJob } from "../enrich";
import type { PrototypeJobView } from "../enrich";
import { buildJobsUrl } from "../url";
import type { JobsQuery } from "../url";
import { VacancyCard } from "./VacancyCard";

/** The guarded list read's result union, derived without importing the transport façade. */
type ListJobsResult = Awaited<ReturnType<typeof listJobs>>;

// Server-rendered result states for the /vacantes list read: the page renders
// the validated `RequestJsonResult` union directly — the reusable vacancy card
// for every item, the empty state with an unfiltered reset link, and the
// retryable error state. Each wire item is enriched locally before rendering,
// so only the vacancies the prototype knows gain extras and a company link,
// and only API-backed metadata is otherwise rendered; optional fields are
// omitted instead of fabricated.

function EmptyState() {
  return (
    <Empty className="rounded-2xl border-border bg-card/60">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <SearchXIcon aria-hidden="true" />
        </EmptyMedia>
        <EmptyTitle>No hay vacantes</EmptyTitle>
        <EmptyDescription>
          No encontramos vacantes para esta búsqueda. Prueba con otros filtros.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button render={<Link href="/vacantes" />}>Quitar filtros</Button>
      </EmptyContent>
    </Empty>
  );
}

function ErrorState({ query }: { query: JobsQuery }) {
  return (
    <section
      role="alert"
      className="flex flex-col items-start gap-3 rounded-2xl border border-border bg-card/60 p-6"
    >
      <h2 className="font-heading text-xl font-medium text-foreground">
        No se pudieron cargar las vacantes
      </h2>
      <p className="max-w-prose text-sm text-muted-foreground">
        El servicio de vacantes no respondió correctamente.
      </p>
      <Button render={<Link href={buildJobsUrl(query)} />}>
        Intentar de nuevo
      </Button>
    </section>
  );
}

/**
 * Canonical careers link for one vacancy, or `undefined` for every vacancy the
 * prototype does not know. The enrichment is the gate — an unknown id whose
 * company name happens to match the prototype stays plain text — and the target
 * resolves by exact id, then exact source name, to the one canonical
 * `/empresas/<companyId>` route.
 */
function companyHrefFor(job: PrototypeJobView): string | undefined {
  if (job.prototype === undefined) return undefined;
  const profile = findCompanyProfile(PROTOTYPE_COMPANY_PROFILES, {
    id: job.company.id,
    name: job.company.name,
  });
  return profile === undefined ? undefined : `/empresas/${profile.companyId}`;
}

export function JobsResults({
  result,
  query,
}: {
  result: ListJobsResult;
  query: JobsQuery;
}) {
  if (!result.ok) {
    return <ErrorState query={query} />;
  }

  const { items, next_cursor } = result.data;
  if (items.length === 0) {
    return <EmptyState />;
  }

  return (
    <>
      <ul aria-label="Listado de vacantes" className="flex flex-col gap-3">
        {items.map((job) => {
          const view = enrichJob(job);
          return (
            <VacancyCard
              key={view.id}
              job={view}
              companyHref={companyHrefFor(view)}
            />
          );
        })}
      </ul>
      {next_cursor && (
        <div className="flex justify-center pt-4">
          <Button
            size="lg"
            variant="outline"
            render={
              <Link
                href={buildJobsUrl({ ...query, cursor: next_cursor })}
                data-jobs-next-link="true"
              />
            }
          >
            Ver más vacantes
          </Button>
        </div>
      )}
    </>
  );
}
