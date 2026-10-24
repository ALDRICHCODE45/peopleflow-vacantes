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
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { StateCard } from "@/components/feedback/state-card";
import { employmentTypeLabel, formatPublishedDate, formatSalary, seniorityLabel, workModeLabel } from "../jobs/formatters";
import type { JobItem } from "../jobs/types";
import { companySiteHeadings, type CompanySiteContent, type CompanySiteHeadingLevel } from "./company-site-content";
import { cn } from "@/lib/utils";

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
  const DetailTag = headingLevel === 1 ? "h3" : "h4";
  const cover = content.coverPhoto;
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
                className={cn(buttonVariants({ variant: "outline", className: "pf-hero-cta-outline min-h-11 px-6" }))}
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
            </CardContent>
            {content.website !== undefined && (
              <CardFooter>
                <a
                  href={content.website}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`self-start ${linkClass}`}
                >
                  Sitio web de {content.name}
                  <ExternalLinkIcon aria-hidden="true" className="size-4" />
                </a>
              </CardFooter>
            )}
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
            <Card data-pf-company-mission className="self-start bg-secondary lg:col-span-5">
              <CardHeader><CardTitle><DetailTag>Nuestra misión</DetailTag></CardTitle></CardHeader>
              <CardContent>
                <p className="text-pretty font-heading text-lg leading-snug text-foreground">
                  {content.mission}
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      </section>

      {/* Authored prose stays prose: punctuation is not evidence of a list. */}
      {content.whatWeDo !== undefined && (
        <section aria-labelledby={headings.capabilitiesId}>
          <SectionTag id={headings.capabilitiesId} className={headingClass}>
            Qué hacemos
          </SectionTag>
          <p data-capability-text className="mt-6 max-w-prose whitespace-pre-wrap leading-relaxed text-foreground">
            {content.whatWeDo}
          </p>
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
          <StateCard className="mt-6" icon={BriefcaseIcon} tone="empty" title="Sin vacantes por ahora"
            description={`${content.name} todavía no lista sus vacantes aquí. Mientras tanto, puedes revisar las vacantes publicadas en PeopleFlow.`}
            primaryAction={{ href: "/vacantes", label: "Ver vacantes publicadas" }} />
        ) : (
          <ul aria-label={`Vacantes en ${content.name}`} className="mt-6 flex flex-col gap-3">
            {jobs.map((job) => {
              // The legacy company projection has no period or basis: disclose the gap, never infer it.
              const salary = formatSalary({ min: job.salary_min, max: job.salary_max, currency: job.salary_currency });
              const WorkModeIcon = WORK_MODE_ICONS[job.work_mode];
              return (
                <li key={job.id}>
                  <Card
                    size="sm"
                    className="transition-[box-shadow,border-color] duration-200 ease-out hover:ring-foreground/10 motion-reduce:transition-none"
                  >
                    <CardHeader>
                      <CardTitle>
                        <DetailTag className="break-words text-lg font-semibold tracking-tight">
                          <Link href={`/vacantes/${job.id}`} className={focusRing}>
                            {job.title}
                          </Link>
                        </DetailTag>
                      </CardTitle>
                      <CardDescription>{job.company.name}</CardDescription>
                    </CardHeader>
                    <CardContent className="flex flex-col gap-3">
                        <div aria-label="Condiciones principales" className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
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
                        </div>
                        <p className="text-sm text-muted-foreground">{employmentTypeLabel(job.employment_type)} · {seniorityLabel(job.seniority)}</p>
                          {job.published_at !== undefined && (
                            <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                              <CalendarDaysIcon aria-hidden="true" className="size-3.5 shrink-0" />
                              Publicada: <time dateTime={job.published_at}>{formatPublishedDate(job.published_at)}</time>
                            </p>
                          )}
                    </CardContent>
                    <CardFooter className="flex-col items-stretch justify-between gap-4 border-t sm:flex-row sm:items-center">
                        <div className="flex flex-col gap-1">
                          <p className="font-heading text-lg font-semibold tabular-nums text-foreground">{salary ?? "Salario no publicado"}</p>
                          {salary !== null && <p className="text-sm text-muted-foreground">Periodicidad y neto/bruto no disponibles</p>}
                        </div>
                        <Link
                          href={`/vacantes/${job.id}`}
                          className={buttonVariants({ className: "min-h-11 w-full sm:w-auto" })}
                        >
                          Ver vacante
                          <ArrowRightIcon aria-hidden="true" data-icon="inline-end" />
                        </Link>
                    </CardFooter>
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
