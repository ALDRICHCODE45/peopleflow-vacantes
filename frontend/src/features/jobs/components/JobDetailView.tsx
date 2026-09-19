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

import { findCompanyProfile } from "../../company-profile/model";
import { PROTOTYPE_COMPANY_PROFILES } from "../../company-profile/prototype-companies";
import type { PrototypeJobView } from "../enrich";
import {
  employmentTypeLabel,
  formatClosingDate,
  formatPublishedDate,
  formatSalary,
  payFrequencyLabel,
  seniorityLabel,
  workModeLabel,
} from "../formatters";

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
 * The prototype profile a vacancy may link to: a profile is only eligible once
 * the prototype enrichment knows the vacancy, and only an exact profile id or
 * exact source-name match resolves. Everything else stays byte-honest.
 */
function prototypeProfile(job: PrototypeJobView) {
  if (job.prototype === undefined) return undefined;
  return findCompanyProfile(PROTOTYPE_COMPANY_PROFILES, {
    id: job.company.id,
    name: job.company.name,
  });
}

/**
 * Disclosed prototype role block, rendered after the wire header and the
 * description. Every value is fictional demo enrichment, so the block never
 * fuses with the wire metadata: it carries no image and no paragraph (the
 * description paragraphs stay the article's only `p` elements), and every
 * requirement, skill, and benefit renders as escaped plain text.
 */
function PrototypeRoleSection({ job }: { job: PrototypeJobView }) {
  const prototype = job.prototype;
  if (prototype === undefined) return null;
  const profile = prototypeProfile(job);
  const closingDate =
    prototype.closingDate === undefined
      ? null
      : formatClosingDate(prototype.closingDate);

  return (
    <section
      aria-labelledby="prototipo-vacante"
      className="flex flex-col gap-6 rounded-2xl border border-dashed border-primary/40 bg-primary/5 p-6 md:p-7"
    >
      <div className="flex flex-col gap-3">
        <h2
          id="prototipo-vacante"
          className="font-heading text-lg font-semibold text-foreground"
        >
          Prototipo · {prototype.department}
        </h2>
        <dl className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
          <div className="flex items-baseline gap-2">
            <dt className="text-muted-foreground">Frecuencia de pago</dt>
            <dd className="font-medium text-foreground">
              {payFrequencyLabel(prototype.payFrequency)}
            </dd>
          </div>
          {closingDate !== null && (
            <div className="flex items-baseline gap-2">
              <dt className="text-muted-foreground">Cierre de postulaciones</dt>
              <dd className="font-medium text-foreground">{closingDate}</dd>
            </div>
          )}
        </dl>
      </div>

      <div className="flex flex-col gap-3">
        <h2 className="font-heading text-base font-semibold text-foreground">
          Requisitos
        </h2>
        <h3 className="text-sm font-semibold text-foreground">Indispensables</h3>
        <ul className="flex flex-col gap-2 text-sm text-muted-foreground">
          {prototype.requiredRequirements.map((requirement) => (
            <li
              key={requirement}
              className="border-l-2 border-primary/40 pl-3 leading-relaxed"
            >
              {requirement}
            </li>
          ))}
        </ul>
        <h3 className="mt-1 text-sm font-semibold text-foreground">Deseables</h3>
        <ul className="flex flex-col gap-2 text-sm text-muted-foreground">
          {prototype.preferredRequirements.map((requirement) => (
            <li
              key={requirement}
              className="border-l-2 border-primary/40 pl-3 leading-relaxed"
            >
              {requirement}
            </li>
          ))}
        </ul>
      </div>

      <div className="flex flex-col gap-3">
        <h2 className="font-heading text-base font-semibold text-foreground">
          Habilidades y beneficios
        </h2>
        <dl className="flex flex-col gap-2 text-sm">
          <div className="flex flex-wrap items-baseline gap-2">
            <dt className="font-medium text-foreground">Habilidades</dt>
            <dd className="flex flex-wrap gap-2">
              {prototype.skills.map((skill) => (
                <span
                  key={skill}
                  className="rounded-md bg-muted px-2.5 py-1 text-xs text-muted-foreground"
                >
                  {skill}
                </span>
              ))}
            </dd>
          </div>
          <div className="flex flex-wrap items-baseline gap-2">
            <dt className="font-medium text-foreground">Beneficios</dt>
            <dd className="text-muted-foreground">
              {prototype.benefits.join(" · ")}
            </dd>
          </div>
        </dl>
      </div>

      {profile !== undefined && (
        <div className="flex flex-col gap-2 rounded-xl border border-border bg-background/70 p-4">
          <strong className="text-xs font-semibold tracking-wide text-foreground uppercase">
            {profile.disclosure.label}
          </strong>
          <div className="text-sm leading-relaxed text-muted-foreground">
            {profile.disclosure.statement}
          </div>
          <Link
            href={`/empresas/${profile.companyId}`}
            className="inline-flex items-center gap-1.5 self-start text-sm font-medium text-primary underline-offset-4 transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Conoce a {profile.name}
          </Link>
        </div>
      )}
    </section>
  );
}

/**
 * Server-rendered validated detail view: one semantic `article` with the title,
 * company, only the supported contract metadata that is actually present
 * (absent optionals are omitted, never fabricated), the plain-text description,
 * and — only for a vacancy the prototype enrichment knows — a clearly
 * disclosed prototype role block that may link to the fictional company
 * profile. No save/share/apply/verified/popularity action or claim exists here,
 * and the wire salary stays in its own header slot rather than inside the
 * disclosed prototype block.
 */
export function JobDetailView({ job }: { job: PrototypeJobView }) {
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

      <PrototypeRoleSection job={job} />
    </article>
  );
}
