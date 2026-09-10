import * as React from "react";
import Link from "next/link";
import {
  ArrowLeftIcon,
  BanknoteIcon,
  BriefcaseIcon,
  Building2Icon,
  CalendarClockIcon,
  GlobeIcon,
  MapPinIcon,
  TrendingUpIcon,
} from "lucide-react";

import {
  employmentTypeLabel,
  formatPublishedDate,
  formatSalary,
  seniorityLabel,
  workModeLabel,
} from "../formatters";
import type { JobItem } from "../types";

/**
 * Splits the validated description on blank lines into paragraphs; single
 * line breaks stay inside one paragraph as preserved text. Everything renders
 * as safe React plain text — no HTML interpretation of description content.
 */
function DescriptionParagraphs({ description }: { description: string }) {
  const paragraphs = description
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0);

  return (
    <div className="space-y-4">
      {paragraphs.map((paragraph, index) => (
        <p
          key={index}
          className="whitespace-pre-line text-[15px] leading-relaxed text-muted-foreground"
        >
          {paragraph}
        </p>
      ))}
    </div>
  );
}

/**
 * Server-rendered validated detail view: one semantic `article` with the
 * title, company, only the supported contract metadata that is actually
 * present (absent optionals are omitted, never fabricated), and the plain-text
 * description. No save/share/apply/company-profile/benefits or structured job
 * sections exist in this slice.
 */
export function JobDetailView({ job }: { job: JobItem }) {
  const salary =
    job.salary_min !== undefined || job.salary_max !== undefined
      ? formatSalary({
          min: job.salary_min,
          max: job.salary_max,
          currency: job.salary_currency,
        })
      : null;

  return (
    <article className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-8">
      <Link
        href="/vacantes"
        className="inline-flex items-center gap-1.5 self-start text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ArrowLeftIcon aria-hidden="true" className="h-4 w-4" />
        Volver a vacantes
      </Link>

      <div className="rounded-2xl border border-border bg-card/60 p-6 md:p-7">
        <h1 className="break-words font-heading text-3xl font-bold tracking-tight text-foreground md:text-4xl">
          {job.title}
        </h1>
        <div className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
          <Building2Icon aria-hidden="true" className="h-4 w-4" />
          <span>{job.company.name}</span>
        </div>
        <ul className="mt-4 flex flex-wrap gap-2">
          <li className="flex items-center gap-1.5 rounded-lg bg-muted/60 px-2.5 py-1 text-[13px] text-muted-foreground">
            <GlobeIcon aria-hidden="true" className="h-3.5 w-3.5" />
            <span>{workModeLabel(job.work_mode)}</span>
          </li>
          <li className="flex items-center gap-1.5 rounded-lg bg-muted/60 px-2.5 py-1 text-[13px] text-muted-foreground">
            <BriefcaseIcon aria-hidden="true" className="h-3.5 w-3.5" />
            <span>{employmentTypeLabel(job.employment_type)}</span>
          </li>
          <li className="flex items-center gap-1.5 rounded-lg bg-muted/60 px-2.5 py-1 text-[13px] text-muted-foreground">
            <TrendingUpIcon aria-hidden="true" className="h-3.5 w-3.5" />
            <span>{seniorityLabel(job.seniority)}</span>
          </li>
        </ul>
        {(job.location !== undefined ||
          salary !== null ||
          job.published_at !== undefined) && (
          <dl className="mt-5 grid gap-4 border-t border-border pt-5 text-sm sm:grid-cols-3">
            {job.location !== undefined && (
              <div>
                <dt className="flex items-center gap-2 text-xs text-muted-foreground">
                  <MapPinIcon aria-hidden="true" className="h-4 w-4" />
                  Ubicación
                </dt>
                <dd className="mt-0.5 font-medium break-words text-foreground">
                  {job.location}
                </dd>
              </div>
            )}
            {salary !== null && (
              <div>
                <dt className="flex items-center gap-2 text-xs text-muted-foreground">
                  <BanknoteIcon aria-hidden="true" className="h-4 w-4" />
                  Salario
                </dt>
                <dd className="mt-0.5 font-medium text-foreground">{salary}</dd>
              </div>
            )}
            {job.published_at !== undefined && (
              <div>
                <dt className="flex items-center gap-2 text-xs text-muted-foreground">
                  <CalendarClockIcon aria-hidden="true" className="h-4 w-4" />
                  Publicada
                </dt>
                <dd className="mt-0.5 font-medium text-foreground">
                  {formatPublishedDate(job.published_at)}
                </dd>
              </div>
            )}
          </dl>
        )}
      </div>

      <div className="rounded-2xl border border-border bg-card/40 p-6 md:p-7">
        <h2 className="font-heading text-xl font-semibold text-foreground">
          Sobre la vacante
        </h2>
        <div className="mt-4">
          <DescriptionParagraphs description={job.description} />
        </div>
      </div>
    </article>
  );
}
