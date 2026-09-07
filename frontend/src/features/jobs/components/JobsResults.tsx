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
import { listJobs } from "../api/listJobs";
import {
  employmentTypeLabel,
  formatPublishedDate,
  formatSalary,
  seniorityLabel,
  workModeLabel,
} from "../formatters";
import { buildJobsUrl } from "../url";
import type { JobsQuery } from "../url";
import type { JobItem } from "../types";

/** The guarded list read's result union, derived without importing the transport façade. */
type ListJobsResult = Awaited<ReturnType<typeof listJobs>>;

// Server-rendered result states for the /vacantes list read: the page renders
// the validated `RequestJsonResult` union directly — success rows, the empty
// state with an unfiltered reset link, and the retryable error state.

function EmptyState() {
  return (
    <Empty className="border-border">
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
    <section role="alert" className="flex flex-col items-start gap-3 py-6">
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

function JobRow({ job }: { job: JobItem }) {
  const salary = formatSalary({
    min: job.salary_min,
    max: job.salary_max,
    currency: job.salary_currency,
  });
  const details = [
    workModeLabel(job.work_mode),
    employmentTypeLabel(job.employment_type),
    seniorityLabel(job.seniority),
    job.location,
    salary,
    job.published_at
      ? `Publicada: ${formatPublishedDate(job.published_at)}`
      : undefined,
  ].filter((detail) => detail !== undefined);

  return (
    <li key={job.id} className="flex flex-col gap-1.5 py-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4">
        <h2 className="font-heading text-base font-medium text-foreground">
          <Link
            href={`/vacantes/${job.id}`}
            className="hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            {job.title}
          </Link>
        </h2>
        <span className="text-sm text-muted-foreground">
          {job.company.name}
        </span>
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-sm text-muted-foreground">
        {details.map((detail) => (
          <span key={detail}>{detail}</span>
        ))}
      </div>
    </li>
  );
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
      <ul
        aria-label="Listado de vacantes"
        className="flex flex-col divide-y divide-border"
      >
        {items.map((job) => (
          <JobRow key={job.id} job={job} />
        ))}
      </ul>
      {next_cursor && (
        <div className="pt-2">
          <Button
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
