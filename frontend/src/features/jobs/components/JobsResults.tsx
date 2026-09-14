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
// the validated `RequestJsonResult` union directly — surfaced vacancy cards,
// the empty state with an unfiltered reset link, and the retryable error
// state. Only API-backed metadata is ever rendered; optional fields are
// omitted instead of fabricated.

/** Deterministic two-letter monogram derived from the company name. */
function companyInitials(name: string): string {
  const words = name.trim().split(/\s+/).slice(0, 2);
  const initials = words.map((word) => word.charAt(0)).join("");
  return initials === "" ? "·" : initials.toUpperCase();
}

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

function JobRow({ job }: { job: JobItem }) {
  const salary = formatSalary({
    min: job.salary_min,
    max: job.salary_max,
    currency: job.salary_currency,
  });
  const details = [
    { key: "work-mode", label: workModeLabel(job.work_mode) },
    { key: "employment-type", label: employmentTypeLabel(job.employment_type) },
    { key: "seniority", label: seniorityLabel(job.seniority) },
  ];
  const companyLine = job.location
    ? `${job.company.name} · ${job.location}`
    : job.company.name;

  return (
    <li className="rounded-2xl border border-border bg-card p-5 [overflow-wrap:anywhere] transition-[transform,border-color,box-shadow] duration-200 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-lg hover:shadow-primary/10 focus-within:-translate-y-0.5 focus-within:border-primary/40 focus-within:shadow-lg focus-within:shadow-primary/10">
      <div className="flex items-start gap-4">
        <span
          aria-hidden="true"
          className="grid size-12 shrink-0 place-items-center rounded-xl bg-primary text-base font-semibold text-primary-foreground"
        >
          {companyInitials(job.company.name)}
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <h3 className="font-heading text-lg font-semibold text-foreground">
            <Link
              href={`/vacantes/${job.id}`}
              className="hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              {job.title}
            </Link>
          </h3>
          <p className="text-sm text-muted-foreground">{companyLine}</p>
          <div className="flex flex-wrap gap-1.5">
            {details.map((detail) => (
              <span
                key={detail.key}
                className="rounded-md bg-muted px-2.5 py-1 text-xs text-muted-foreground"
              >
                {detail.label}
              </span>
            ))}
          </div>
        </div>
      </div>
      {(salary !== null || job.published_at !== undefined) && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-border pt-3.5 text-sm text-muted-foreground">
          {salary !== null && (
            <span className="font-medium text-foreground">{salary}</span>
          )}
          {job.published_at && (
            <span>Publicada: {formatPublishedDate(job.published_at)}</span>
          )}
        </div>
      )}
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
      <ul aria-label="Listado de vacantes" className="flex flex-col gap-3">
        {items.map((job) => (
          <JobRow key={job.id} job={job} />
        ))}
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
