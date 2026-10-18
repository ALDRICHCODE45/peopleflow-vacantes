import * as React from "react";
import Link from "next/link";
import { ArrowRightIcon, BriefcaseIcon, Building2Icon, ClockIcon, GlobeIcon, MapPinIcon, UsersIcon, ZapIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import type { PrototypeJobView } from "../enrich";
import type { PublicJobItem } from "../types";
import { PublicVacancyCard } from "./PublicVacancyCard";
import type { PublicVacancyCardExtras } from "./public-vacancy-layout";
import { employmentTypeLabel, formatPublishedDate, formatSalary, payFrequencyLabel, seniorityLabel, workModeLabel } from "../formatters";
import { PrototypeFeedbackButton } from "./prototype-feedback-island";
import { CompanyMonogram, VerifiedByPeopleFlow, prototypeApplicantsLabel, prototypeResponseLabel } from "./prototype-ui";

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
/** Native Card surface with the existing restrained hover lift. */
const cardClass = "group [overflow-wrap:anywhere] transition-[translate,box-shadow] duration-200 ease-out hover:shadow-lg hover:shadow-primary/5 motion-safe:hover:-translate-y-0.5 motion-safe:focus-within:-translate-y-0.5 motion-reduce:translate-none motion-reduce:transition-none";
/** Closing salary metadata and the single detail CTA share the native footer. */
const railClass = "flex min-w-0 flex-wrap justify-between gap-3 border-t";
const railLabel = "text-xs font-semibold tracking-wide text-muted-foreground uppercase";
const ctaClass = `${focusRing} inline-flex min-h-10 w-full items-center justify-center gap-1.5 rounded-xl border border-border bg-background px-3.5 text-sm font-semibold text-foreground transition-colors duration-150 hover:border-primary/50 hover:bg-muted`;
const bookmarkClass = `${focusRing} grid size-10 shrink-0 place-items-center rounded-xl border border-border bg-background text-muted-foreground`;

/**
 * One public vacancy as a list item with native Card composition: the
 * company monogram, the canonical `/vacantes/<id>` title link, the opt-in
 * company link, the wire facts through the existing formatters, and — only for
 * a vacancy the prototype enrichment knows — the featured marker, applicant
 * count, relative publication label, department, the complete normalized
 * description clipped to two lines, skills, benefits, pay cadence, response
 * estimate, and verification. The salary
 * lives in the footer. A known prototype vacancy carries the bookmark
 * placeholder control, and a wire-only vacancy carries no save control at all,
 * so no card here performs a business mutation while the card itself stays a
 * server component: it forwards plain strings to the control and owns no fetch,
 * state, hook, request, storage, raw color, or inline style.
 */
export function VacancyCard({ job, companyHref, ...extras }: { job: PrototypeJobView | PublicJobItem; companyHref?: string } & PublicVacancyCardExtras) {
  if ("source" in job) return <PublicVacancyCard job={job} {...extras} />;
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
    <li>
      <Card className={cardClass}>
        <CardHeader>
          <CardTitle><h3 className="flex items-start gap-3.5 font-heading text-lg font-semibold tracking-tight">
            <CompanyMonogram name={job.company.name} />
            <Link href={`/vacantes/${job.id}`} className={`min-w-0 hover:underline ${focusRing}`}>{job.title}</Link>
          </h3></CardTitle>
          <CardDescription>
            {companyHref === undefined ? job.company.name : <Link href={companyHref} className={`font-medium text-foreground underline decoration-foreground/50 underline-offset-4 transition-colors hover:decoration-foreground ${focusRing}`}>{job.company.name}</Link>}
          </CardDescription>
          {prototype !== undefined && <CardAction className="flex flex-wrap items-center justify-end gap-2">
            {prototype.featured && <Badge variant="accent" data-prototype-featured>Destacada</Badge>}
            <PrototypeFeedbackButton icon="bookmark" label="Guardar vacante" className={bookmarkClass} />
          </CardAction>}
        </CardHeader>
        <CardContent className="flex min-w-0 flex-col gap-3">

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
            <Separator />
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
        </CardContent>

        <CardFooter className={railClass}>
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
        <Link href={`/vacantes/${job.id}`} className={`${ctaClass} sm:w-auto`}>
          Ver vacante
          <ArrowRightIcon aria-hidden="true" className="size-4 shrink-0 transition-transform duration-150 motion-reduce:transition-none motion-safe:group-hover:translate-x-0.5" />
        </Link>
        {prototype?.verifiedByPeopleFlow === true && <VerifiedByPeopleFlow />}
        </CardFooter>
      </Card>
    </li>
  );
}
