import * as React from "react";
import Link from "next/link";
import { ArrowRightIcon, BriefcaseIcon, Building2Icon, ClockIcon, GlobeIcon, MapPinIcon, UsersIcon, ZapIcon } from "lucide-react";

import type { PrototypeJobView } from "../enrich";
import { employmentTypeLabel, formatPublishedDate, formatSalary, payFrequencyLabel, seniorityLabel, workModeLabel } from "../formatters";
import { PrototypeFeedbackButton } from "./prototype-feedback-island";
import { CompanyMonogram, PrototypeDisclosure, VerifiedByPeopleFlow, prototypeApplicantsLabel, prototypeResponseLabel } from "./prototype-ui";

/** Contextual icon per wire work mode, mirroring the public board rows. */
const WORK_MODE_ICONS = {
  onsite: MapPinIcon,
  remote: GlobeIcon,
  hybrid: Building2Icon,
} as const satisfies Record<PrototypeJobView["work_mode"], typeof MapPinIcon>;

/**
 * Collapses every whitespace run of the wire description — the line breaks of a
 * rich detail text included — into one space, and changes nothing else. The
 * complete normalized text stays in the DOM as wire content: how much of it a
 * card shows is a presentation concern owned by the `line-clamp-2` utility, not
 * a pre-render substring, so no code point is lost from the document or from
 * the accessible text by a character budget.
 */
function normalizedDescription(description: string): string {
  return description.replace(/\s+/gu, " ").trim();
}

/** Keyboard focus ring and the quiet chip style shared with the board and detail. */
const focusRing = "rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";
const chip = "flex items-center gap-1.5 rounded-md bg-muted px-2.5 py-1 text-xs text-muted-foreground";
const metaRow = "flex items-center gap-1.5";
/** Reference surface, grid, and the one restrained hover lift of the card. */
const cardClass = "group relative grid gap-5 overflow-visible rounded-2xl border border-border bg-card/60 p-4 [overflow-wrap:anywhere] transition-[translate,border-color,box-shadow] duration-200 ease-out hover:border-primary/40 hover:shadow-lg hover:shadow-primary/5 focus-within:border-primary/40 motion-safe:hover:-translate-y-0.5 motion-safe:focus-within:-translate-y-0.5 motion-reduce:translate-none motion-reduce:transition-none md:grid-cols-[minmax(0,1fr)_16rem] md:gap-6 md:p-6";
/** One integrated salary rail: stacked under the content, a bordered column at md. */
const railClass = "flex min-w-0 flex-col gap-3 border-t border-border pt-4 md:border-t-0 md:border-l md:pt-0 md:pl-6";
const railLabel = "text-xs font-semibold tracking-wide text-muted-foreground uppercase";
const ctaClass = `${focusRing} inline-flex min-h-10 w-full items-center justify-center gap-1.5 rounded-xl border border-border bg-background px-3.5 text-sm font-semibold text-foreground transition-colors duration-150 hover:border-primary/50 hover:bg-muted`;
const bookmarkClass = `${focusRing} grid size-10 shrink-0 place-items-center rounded-xl border border-border bg-background text-muted-foreground`;
/**
 * Featured status bubble: it straddles the card's upper-right border like a
 * connectivity pill, so it consumes no grid region. `-top-3` keeps its lower
 * half inside the card's own padding while clearing the bookmark and the
 * salary rail label; the positive `right` inset keeps it inside the card's
 * horizontal bounds at both widths.
 */
const featuredPillClass = "absolute -top-3 right-4 inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-card px-2.5 py-1 text-xs font-semibold leading-none text-foreground shadow-sm md:right-6";
/** The pill's status dot, drawn from the semantic brand token only. */
const featuredDotClass = "size-1.5 shrink-0 rounded-full bg-primary";

/**
 * One public vacancy as a list item in the reference horizontal shape: the
 * company monogram, the canonical `/vacantes/<id>` title link, the opt-in
 * company link, the wire facts through the existing formatters, and — only for
 * a vacancy the prototype enrichment knows — the featured marker, applicant
 * count, relative publication label, department, the complete normalized
 * description clipped to two lines, skills, benefits, pay cadence, response
 * estimate, verification, and the disclosure that scopes all of it. The salary
 * lives in its own rail. A known prototype vacancy carries the bookmark client
 * island, and a wire-only vacancy carries no save control at all, so no card
 * here performs a business mutation while the card itself stays a server
 * component: it forwards plain strings to the island and owns no fetch, state,
 * hook, request, storage, raw color, or inline style.
 */
export function VacancyCard({ job, companyHref }: { job: PrototypeJobView; companyHref?: string }) {
  const prototype = job.prototype;
  const salary = formatSalary({ min: job.salary_min, max: job.salary_max, currency: job.salary_currency });
  const published = prototype?.publishedAgoLabel ?? (job.published_at === undefined ? undefined : `Publicada: ${formatPublishedDate(job.published_at)}`);
  const salaryLabel = prototype === undefined ? "SALARIO" : `SALARIO ${payFrequencyLabel(prototype.payFrequency).toUpperCase()}`;
  const wireMeta = [
    { key: "work-mode", label: workModeLabel(job.work_mode), Icon: WORK_MODE_ICONS[job.work_mode] },
    { key: "employment-type", label: employmentTypeLabel(job.employment_type), Icon: BriefcaseIcon },
    { key: "seniority", label: seniorityLabel(job.seniority), Icon: null },
  ];

  return (
    <li className={cardClass}>
      <div className="flex min-w-0 flex-col gap-3">
        <div className="flex items-start gap-3.5">
          <CompanyMonogram name={job.company.name} />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <h3 className="font-heading text-lg font-semibold tracking-tight text-foreground">
              <Link href={`/vacantes/${job.id}`} className={`hover:underline ${focusRing}`}>{job.title}</Link>
            </h3>
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <p className="text-sm text-muted-foreground">
                {companyHref === undefined
                  ? job.company.name
                  : <Link href={companyHref} className={`font-medium text-foreground underline decoration-foreground/50 underline-offset-4 transition-colors hover:decoration-foreground ${focusRing}`}>{job.company.name}</Link>}
              </p>
            </div>
          </div>
          {prototype !== undefined && (
            <PrototypeFeedbackButton
              mode="toggle"
              icon="bookmark"
              label="Guardar vacante (solo demostración)" activeLabel="Guardar vacante (marcada solo en esta demostración)"
              activeFeedback="Guardado de demostración activado: no se guardó nada real."
              inactiveFeedback="Guardado de demostración desactivado: no se modificó nada real."
              className={bookmarkClass}
            />
          )}
        </div>

        {prototype?.featured === true && (
          <span data-prototype-featured className={featuredPillClass}>
            <span data-prototype-featured-dot className={featuredDotClass} />
            Destacada
          </span>
        )}

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
          {job.location !== undefined && <span className={metaRow}><MapPinIcon aria-hidden="true" className="size-3.5 shrink-0" />{job.location}</span>}
          {published !== undefined && <span className={metaRow}><ClockIcon aria-hidden="true" className="size-3.5 shrink-0" />{published}</span>}
          {prototype !== undefined && <span className={metaRow}><UsersIcon aria-hidden="true" className="size-3.5 shrink-0" />{prototypeApplicantsLabel(prototype.applicantCount)}</span>}
        </div>

        <div className="flex flex-wrap gap-2">
          {wireMeta.map(({ key, label, Icon }) => (
            <span key={key} className={chip}>
              {Icon && <Icon aria-hidden="true" className="size-3.5 shrink-0" />}
              {label}
            </span>
          ))}
          {prototype !== undefined && <span key="department" className={chip}>{prototype.department}</span>}
        </div>

        <p className="line-clamp-2 text-sm leading-relaxed text-muted-foreground">{normalizedDescription(job.description)}</p>

        {prototype !== undefined && (
          <>
            <div className="h-px w-full bg-border" />
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <div className="flex min-w-0 flex-col gap-1.5">
                <dt className="font-medium text-foreground">Habilidades</dt>
                <dd className="flex flex-wrap gap-1.5">{prototype.skills.map((skill) => <span key={skill} className={chip}>{skill}</span>)}</dd>
              </div>
              <div className="flex min-w-0 flex-col gap-1.5">
                <dt className="font-medium text-foreground">Beneficios</dt>
                <dd className="text-muted-foreground">{prototype.benefits.join(" · ")}</dd>
              </div>
            </dl>
          </>
        )}
      </div>

      <div className={railClass}>
        <div className="flex flex-col gap-1">
          <p className={railLabel}>{salaryLabel}</p>
          <p className="font-heading text-lg font-semibold text-foreground">{salary ?? "Salario a convenir"}</p>
        </div>
        {prototype !== undefined && (
          <p className={`${metaRow} text-xs text-muted-foreground`}>
            <ZapIcon aria-hidden="true" className="size-3.5 shrink-0" />
            {prototypeResponseLabel(prototype.responseTimeDays)}
          </p>
        )}
        <Link href={`/vacantes/${job.id}`} className={ctaClass}>
          Ver vacante
          <ArrowRightIcon aria-hidden="true" className="size-4 shrink-0 transition-transform duration-150 motion-reduce:transition-none motion-safe:group-hover:translate-x-0.5" />
        </Link>
        {prototype?.verifiedByPeopleFlow === true && <VerifiedByPeopleFlow />}
        {prototype !== undefined && <PrototypeDisclosure />}
      </div>
    </li>
  );
}
