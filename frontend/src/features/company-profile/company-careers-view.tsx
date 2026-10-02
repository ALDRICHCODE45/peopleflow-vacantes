import * as React from "react";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowRightIcon,
  BriefcaseIcon,
  Building2Icon,
  CalendarDaysIcon,
  ExternalLinkIcon,
  GlobeIcon,
  MapPinIcon,
  UsersIcon,
} from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { employmentTypeLabel, formatPublishedDate, formatSalary, seniorityLabel, workModeLabel } from "../jobs/formatters";
import type { JobItem } from "../jobs/types";
import { companySiteHeadings, type CompanySiteContent, type CompanySiteHeadingLevel } from "./company-site-content";

/** Keyboard focus ring shared by every interactive element on this page. */
const focusRing =
  "rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";
/**
 * The two body-sized navigation links of this page. They use the semantic
 * `text-foreground` token rather than the violet accent: `--primary` only
 * reaches ~2.1:1 on the dark page background, while body text needs 4.5:1.
 * The underline stays visible without hover, and hover only strengthens its
 * decoration color, so neither state depends on a low-contrast color.
 */
const linkClass = `text-sm font-medium text-foreground underline decoration-foreground/50 underline-offset-4 transition-colors hover:decoration-foreground ${focusRing}`;
/** One section heading, offset below the sticky public navbar when jumped to. */
const headingClass = "scroll-mt-24 font-heading text-2xl font-semibold tracking-tight text-foreground";
/** A fact label with its contextual icon; the icon never carries meaning alone. */
const factLabelClass = "flex items-center gap-1.5 text-xs text-muted-foreground";
const factValueClass = "font-heading text-base font-medium text-foreground";

/** Contextual icon per wire work mode, mirroring the public board rows. */
const WORK_MODE_ICONS = {
  onsite: MapPinIcon,
  remote: GlobeIcon,
  hybrid: Building2Icon,
} as const satisfies Record<JobItem["work_mode"], typeof MapPinIcon>;

/**
 * Splits the profile's own `whatWeDo` sentence on its enumerating punctuation.
 * It is a verbatim, deterministic split of profile content, so a highlight can
 * never claim a capability the profile does not state; a sentence with nothing
 * to split stays one highlight instead of rendering an empty list.
 */
function whatWeDoHighlights(whatWeDo: string): string[] {
  const clauses = whatWeDo
    .split(/,\s*|\s+y\s+(?=[a-záéíóúñ])/u)
    .map((clause) => clause.trim())
    .filter((clause) => clause.length > 0);
  return (clauses.length > 0 ? clauses : [whatWeDo]).map(
    (clause) => clause.charAt(0).toUpperCase() + clause.slice(1),
  );
}

/**
 * Server-rendered editorial careers site for one company. The caller supplies
 * identity-only presentation content (the public route derives it from the
 * approved profile) plus wire-backed vacancies, so the view never invents a
 * metric, credential, benefit, or action, and no directive, hook, provider, or
 * request lives in this module. `headingLevel` and `idPrefix` let the same
 * renderer be embedded in an editor preview as H2/H3 without duplicate ids or
 * a second H1.
 */
export function CompanyCareersView({
  content,
  jobs,
  headingLevel = 1,
  idPrefix = "",
}: {
  content: CompanySiteContent;
  jobs: readonly JobItem[];
  headingLevel?: CompanySiteHeadingLevel;
  idPrefix?: string;
}) {
  const headings = companySiteHeadings(headingLevel, idPrefix);
  const NameTag = headings.nameTag;
  const SectionTag = headings.sectionTag;
  const cover = content.coverPhoto;
  const highlights = content.whatWeDo === undefined ? [] : whatWeDoHighlights(content.whatWeDo);
  const facts = [
    content.location === undefined ? null : { label: "Ubicación", value: content.location, Icon: MapPinIcon },
    content.companySize === undefined ? null : { label: "Tamaño del equipo", value: content.companySize, Icon: UsersIcon },
    content.foundedYear === undefined ? null : { label: "Fundada", value: String(content.foundedYear), Icon: CalendarDaysIcon },
    content.workStyle === undefined ? null : { label: "Forma de trabajo", value: content.workStyle, Icon: Building2Icon },
  ].flatMap((fact) => (fact === null ? [] : [fact]));
  const hasStory = content.about !== undefined || content.mission !== undefined;

  return (
    <article className="flex w-full flex-col gap-12 md:gap-16">
      {/* Immersive hero: the licensed local cover is the visual, and the copy
          rides it directly on a dark overlay instead of an opaque card. A draft
          without a cover falls back to the neutral `bg-secondary` surface, so
          the headline and its two anchors stay legible in both themes; the
          hero-scoped tokens in globals.css own that paint. */}
      <section
        aria-labelledby={headings.nameId}
        data-pf-hero=""
        data-pf-hero-cover={cover !== undefined ? "true" : "false"}
        className="pf-hero relative isolate w-full overflow-hidden rounded-[min(var(--radius-4xl),28px)] bg-secondary ring-1 ring-foreground/5"
      >
        {cover !== undefined && (
          <Image
            src={cover.url}
            alt={cover.alt}
            fill
            priority
            sizes="100vw"
            className="object-cover"
          />
        )}
        <div
          data-pf-hero-overlay=""
          className="pf-hero-overlay relative flex min-h-[min(85vh,44rem)] w-full items-center justify-center p-6 md:p-10"
        >
          <div className="flex w-full max-w-3xl flex-col items-center gap-6 text-center">
            <NameTag
              id={headings.nameId}
              className="pf-hero-title text-balance break-words font-heading text-4xl font-bold tracking-tight md:text-5xl lg:text-6xl"
            >
              {content.name}
            </NameTag>
            {content.tagline !== undefined && content.tagline.length > 0 && (
              <p className="pf-hero-subtitle max-w-2xl text-pretty text-lg leading-relaxed">
                {content.tagline}
              </p>
            )}
            <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
              <a
                href={`#${headings.jobsId}`}
                className={buttonVariants({ className: "pf-hero-cta min-h-11 px-6" })}
              >
                Ver vacantes
              </a>
              <a
                href={`#${headings.storyId}`}
                className={buttonVariants({ variant: "outline", className: "pf-hero-cta-outline min-h-11 px-6" })}
              >
                Conoce la empresa
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* Fact strip: one elevated surface for the approved facts, each labelled
          with a contextual icon, plus the single safe external link. Omitted
          entirely when a draft has no approved facts yet. */}
      {facts.length > 0 && (
        <section aria-label="Datos de la empresa">
          <Card>
            <CardContent className="flex flex-col gap-6">
              <dl className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
                {facts.map((fact) => (
                  <div key={fact.label} className="flex min-w-0 flex-col gap-1.5">
                    <dt className={factLabelClass}>
                      <fact.Icon aria-hidden="true" className="size-3.5 shrink-0" />
                      {fact.label}
                    </dt>
                    <dd className={factValueClass}>{fact.value}</dd>
                  </div>
                ))}
              </dl>
              {content.website !== undefined && (
                <a
                  href={content.website}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`self-start ${linkClass}`}
                >
                  Sitio web de {content.name}
                  <ExternalLinkIcon aria-hidden="true" className="size-4" />
                </a>
              )}
            </CardContent>
          </Card>
        </section>
      )}

      {/* Story and mission split: the narrative card runs alongside a distinct
          mission surface, so the two never collapse into equal repeated cards. */}
      <section aria-labelledby={headings.storyId}>
        <div className="grid gap-8 lg:grid-cols-12 lg:gap-12">
          <div className="flex flex-col gap-5 lg:col-span-7">
            <SectionTag id={headings.storyId} className={headingClass}>
              Sobre {content.name}
            </SectionTag>
            {content.about !== undefined && (
              <p className="max-w-prose leading-relaxed text-muted-foreground">{content.about}</p>
            )}
            {!hasStory && (
              <p className="max-w-prose leading-relaxed text-muted-foreground">
                Aún no hay una historia aprobada para {content.name}.
              </p>
            )}
          </div>
          {content.mission !== undefined && (
            <Card className="self-start bg-secondary lg:col-span-5">
              <CardContent className="flex flex-col gap-3">
                <p className="text-sm font-medium text-foreground">Nuestra misión</p>
                <p className="text-pretty font-heading text-lg leading-snug text-foreground">
                  {content.mission}
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      </section>

      {/* Capability rows: verbatim profile capabilities as full-width rows with
          a single leading marker each, never a templated three-card grid. */}
      {content.whatWeDo !== undefined && (
        <section aria-labelledby={headings.capabilitiesId}>
          <SectionTag id={headings.capabilitiesId} className={headingClass}>
            Qué hacemos
          </SectionTag>
          <ul className="mt-6 flex flex-col">
            {highlights.map((highlight) => (
              <li
                key={highlight}
                className="flex items-start gap-4 border-b border-border py-5 first:border-t"
              >
                <span
                  aria-hidden="true"
                  className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground"
                >
                  <ArrowRightIcon className="size-4" />
                </span>
                <p data-capability-text className="max-w-prose leading-relaxed text-foreground">
                  {highlight}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Vacancy seam: with no wire vacancy the section says exactly that and
          points at the real public board; with vacancies it lists the company's
          own roles from wire fields only, each linked to its canonical page. */}
      <section aria-labelledby={headings.jobsId} className="border-t border-border pt-10">
        <SectionTag id={headings.jobsId} className={headingClass}>
          Vacantes
        </SectionTag>
        {jobs.length === 0 ? (
          <Empty className="mt-6 border border-border bg-card">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <BriefcaseIcon aria-hidden="true" />
              </EmptyMedia>
              <EmptyTitle>Sin vacantes por ahora</EmptyTitle>
              <EmptyDescription>
                {content.name} todavía no lista sus vacantes aquí. Mientras tanto, puedes revisar
                las vacantes publicadas en PeopleFlow.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Link href="/vacantes" className={linkClass}>
                Ver vacantes publicadas
              </Link>
            </EmptyContent>
          </Empty>
        ) : (
          <ul aria-label={`Vacantes en ${content.name}`} className="mt-6 flex flex-col gap-3">
            {jobs.map((job) => {
              const WorkModeIcon = WORK_MODE_ICONS[job.work_mode];
              return (
                <li key={job.id}>
                  <Card
                    size="sm"
                    className="transition-[box-shadow,border-color] duration-200 ease-out hover:ring-foreground/10 motion-reduce:transition-none"
                  >
                    <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
                      <div className="flex min-w-0 flex-col gap-2">
                        <h3 className="font-heading text-lg font-semibold tracking-tight text-foreground">
                          <Link href={`/vacantes/${job.id}`} className={focusRing}>
                            {job.title}
                          </Link>
                        </h3>
                        <p className="text-sm text-muted-foreground">{job.company.name}</p>
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
                          {job.location !== undefined && (
                            <span className="flex items-center gap-1.5">
                              <MapPinIcon aria-hidden="true" className="size-3.5 shrink-0" />
                              {job.location}
                            </span>
                          )}
                          <span className="flex items-center gap-1.5">
                            <WorkModeIcon aria-hidden="true" className="size-3.5 shrink-0" />
                            {workModeLabel(job.work_mode)}
                          </span>
                          <span className="flex items-center gap-1.5">
                            <BriefcaseIcon aria-hidden="true" className="size-3.5 shrink-0" />
                            {employmentTypeLabel(job.employment_type)}
                          </span>
                          <span>{seniorityLabel(job.seniority)}</span>
                          {job.published_at !== undefined && (
                            <span className="flex items-center gap-1.5">
                              <CalendarDaysIcon aria-hidden="true" className="size-3.5 shrink-0" />
                              Publicada: {formatPublishedDate(job.published_at)}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex shrink-0 flex-col gap-2 sm:items-end">
                        <p className="font-heading text-base font-semibold text-foreground">
                          {formatSalary({
                            min: job.salary_min,
                            max: job.salary_max,
                            currency: job.salary_currency,
                          }) ?? "Salario a convenir"}
                        </p>
                        <Link
                          href={`/vacantes/${job.id}`}
                          className={`inline-flex min-h-10 items-center gap-1.5 ${linkClass}`}
                        >
                          Ver vacante
                          <ArrowRightIcon aria-hidden="true" className="size-4" />
                        </Link>
                      </div>
                    </CardContent>
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </article>
  );
}
