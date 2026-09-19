import * as React from "react";
import Link from "next/link";
import { BriefcaseIcon, Building2Icon, GlobeIcon, MapPinIcon } from "lucide-react";

import type { PrototypeJobView } from "../enrich";
import { employmentTypeLabel, formatPublishedDate, formatSalary, seniorityLabel, workModeLabel } from "../formatters";

/** Contextual icon per wire work mode, mirroring the public board rows. */
const WORK_MODE_ICONS = {
  onsite: MapPinIcon,
  remote: GlobeIcon,
  hybrid: Building2Icon,
} as const satisfies Record<PrototypeJobView["work_mode"], typeof MapPinIcon>;

/** Longest description excerpt a card shows before it clips on a whole word. */
const EXCERPT_MAX_LENGTH = 160;

/**
 * Collapses every whitespace run of the wire description — the line breaks of a
 * rich detail text included — into one space, then clips an over-budget excerpt
 * on an ellipsis at its last whole word, counted in whole code points so a
 * surrogate pair is never split. A single token longer than the budget is
 * clipped at the budget instead. Markup arriving as wire text stays text.
 */
function descriptionExcerpt(description: string): string {
  const normalized = description.replace(/\s+/gu, " ").trim();
  const points = Array.from(normalized);
  if (points.length <= EXCERPT_MAX_LENGTH) return normalized;
  const clipped = points.slice(0, EXCERPT_MAX_LENGTH);
  const breakAt = clipped.lastIndexOf(" ");
  return `${(breakAt > 0 ? clipped.slice(0, breakAt) : clipped).join("").trimEnd()}…`;
}

/** Keyboard focus ring and the one quiet chip style shared with the board. */
const focusRing = "rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";
const chip = "flex items-center gap-1.5 rounded-md bg-muted px-2.5 py-1 text-xs text-muted-foreground";

/**
 * One public vacancy as a list item, server-rendered from a `PrototypeJobView`:
 * the canonical `/vacantes/<id>` title link, the wire facts through the existing
 * formatters, and — only for a vacancy the prototype enrichment knows — the
 * prototype marker, department, description excerpt, skills, and benefits. The
 * company is plain text unless the caller opts into a company link, so a company
 * page never links back to itself, and no action, pay frequency, requirement,
 * closing date, verification, or popularity claim is ever rendered. Exactly two
 * element children keep the card stable for later board work.
 */
export function VacancyCard({ job, companyHref }: { job: PrototypeJobView; companyHref?: string }) {
  const prototype = job.prototype;
  const salary = formatSalary({ min: job.salary_min, max: job.salary_max, currency: job.salary_currency });
  const wireMeta = [
    { key: "work-mode", label: workModeLabel(job.work_mode), Icon: WORK_MODE_ICONS[job.work_mode] },
    { key: "employment-type", label: employmentTypeLabel(job.employment_type), Icon: BriefcaseIcon },
    { key: "seniority", label: seniorityLabel(job.seniority), Icon: null },
  ];

  return (
    <li className="flex flex-col gap-3 rounded-2xl border border-border bg-card/60 p-4 [overflow-wrap:anywhere] transition-[transform,border-color] duration-200 hover:-translate-y-0.5 hover:border-primary/40 focus-within:-translate-y-0.5 focus-within:border-primary/40 sm:p-5">
      <div className="flex flex-col gap-1">
        <h3 className="font-heading text-lg font-semibold tracking-tight text-foreground">
          <Link href={`/vacantes/${job.id}`} className={`hover:underline ${focusRing}`}>{job.title}</Link>
        </h3>
        <p className="text-sm text-muted-foreground">
          {companyHref === undefined
            ? job.company.name
            : <Link href={companyHref} className={`font-medium text-primary hover:underline ${focusRing}`}>{job.company.name}</Link>}
        </p>
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-2">
          {wireMeta.map(({ key, label, Icon }) => (
            <span key={key} className={chip}>
              {Icon && <Icon aria-hidden="true" className="size-3.5 shrink-0" />}
              {label}
            </span>
          ))}
        </div>

        {(salary !== null || job.location !== undefined || job.published_at !== undefined) && (
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm text-muted-foreground">
            {salary !== null && <span className="font-medium text-foreground">{salary}</span>}
            {job.location !== undefined && <span>{job.location}</span>}
            {job.published_at !== undefined && <span>Publicada: {formatPublishedDate(job.published_at)}</span>}
          </div>
        )}

        {prototype && (
          <div className="flex flex-col gap-2 border-t border-border pt-3">
            <p className="text-sm text-muted-foreground">
              <span className="font-semibold text-foreground">Prototipo</span> · {prototype.department}
            </p>
            <p className="max-w-prose leading-relaxed text-muted-foreground">{descriptionExcerpt(job.description)}</p>
            <dl className="flex flex-col gap-1.5 text-sm">
              <div className="flex flex-wrap items-center gap-1.5">
                <dt className="font-medium text-foreground">Habilidades</dt>
                {prototype.skills.map((skill) => <dd key={skill} className={chip}>{skill}</dd>)}
              </div>
              <div className="flex flex-wrap items-baseline gap-1.5">
                <dt className="font-medium text-foreground">Beneficios</dt>
                <dd className="text-muted-foreground">{prototype.benefits.join(" · ")}</dd>
              </div>
            </dl>
          </div>
        )}
      </div>
    </li>
  );
}
