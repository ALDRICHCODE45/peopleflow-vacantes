import * as React from "react";
import Image from "next/image";
import Link from "next/link";
import { ExternalLinkIcon } from "lucide-react";

import type { PrototypeJobView } from "../jobs/enrich";
import { VacancyCard } from "../jobs/components/VacancyCard";
import type { CompanyProfile } from "./model";

/** Keyboard focus ring shared by every interactive element on this page. */
const focusRing =
  "rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";
/** The one violet affordance: the two navigation links of this page. */
const linkClass = `text-sm font-medium text-primary underline-offset-4 transition-colors hover:underline ${focusRing}`;
const headingClass =
  "font-heading text-2xl font-semibold tracking-tight text-foreground";

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
 * Server-rendered careers profile for one fictional prototype company: identity
 * and cover first, then the facts, narrative, and the vacancy list the caller
 * supplies as local prototype fixtures. Every string comes from the profile and
 * the frozen vacancy fixtures, so the view never invents a metric, credential,
 * or action, and no directive, hook, provider, or request lives in this module.
 */
export function CompanyCareersView({
  profile,
  jobs,
}: {
  profile: CompanyProfile;
  jobs: readonly PrototypeJobView[];
}) {
  const highlights = whatWeDoHighlights(profile.whatWeDo);
  const facts = [
    { label: "Ubicación", value: profile.location },
    { label: "Tamaño del equipo", value: profile.companySize },
    { label: "Fundada", value: String(profile.foundedYear) },
    { label: "Forma de trabajo", value: profile.workStyle },
  ];

  return (
    <article className="flex w-full flex-col gap-12">
      {/* Asymmetric hero: a 7/5 editorial split where the photographic cover
          carries identity and the single H1 states who the company is. */}
      <section aria-labelledby="empresa" className="grid items-end gap-8 lg:grid-cols-12 lg:gap-10">
        <div className="flex flex-col gap-4 lg:col-span-7">
          <h1 id="empresa" className="break-words font-heading text-4xl font-bold tracking-tight text-foreground md:text-5xl lg:text-6xl">
            {profile.name}
          </h1>
          <p className="max-w-prose text-lg leading-relaxed text-muted-foreground">{profile.tagline}</p>
          <div className="mt-2 flex max-w-prose flex-col gap-1.5 rounded-xl border border-primary/30 bg-primary/5 p-4">
            <strong className="text-xs font-semibold uppercase tracking-wide text-foreground">
              {profile.disclosure.label}
            </strong>
            <p className="text-sm leading-relaxed text-muted-foreground">{profile.disclosure.statement}</p>
          </div>
        </div>
        <figure className="lg:col-span-5">
          <div className="overflow-hidden rounded-2xl border border-border bg-muted">
            {/* The cover is a shipped local asset (provenance next to the file),
                so the route keeps its own origin: no remote image configuration
                and no third-party request. `priority` marks it as this route's
                LCP image; `sizes` matches the 5/12 hero column. */}
            <Image
              src={profile.coverPhoto.url}
              alt={profile.coverPhoto.alt}
              width={1600}
              height={900}
              priority
              sizes="(min-width: 1024px) 40vw, 100vw"
              className="h-full w-full object-cover"
            />
          </div>
        </figure>
      </section>

      <div className="grid gap-10 border-t border-border pt-10 lg:grid-cols-12 lg:gap-12">
        {/* Facts are one labelled region with no heading: this page's section
            hierarchy is exactly Sobre / Qué hacemos / Vacantes. */}
        <section aria-label="Datos de la empresa" className="lg:col-span-5">
          <dl className="flex flex-col gap-4 text-sm">
            {facts.map((fact) => (
              <div key={fact.label} className="border-b border-border/60 pb-4 last:border-b-0 last:pb-0">
                <dt className="text-xs text-muted-foreground">{fact.label}</dt>
                <dd className="mt-1 font-medium text-foreground">{fact.value}</dd>
              </div>
            ))}
          </dl>
          <a href={profile.website} target="_blank" rel="noopener noreferrer" className={`mt-6 inline-flex items-center gap-1.5 ${linkClass}`}>
            Sitio web de {profile.name}
            <ExternalLinkIcon aria-hidden="true" className="h-4 w-4" />
          </a>
        </section>

        <div className="flex flex-col gap-10 lg:col-span-7">
          <section aria-labelledby="sobre-empresa" className="flex flex-col gap-4">
            <h2 id="sobre-empresa" className={headingClass}>Sobre {profile.name}</h2>
            <p className="max-w-prose leading-relaxed text-muted-foreground">{profile.about}</p>
            <p className="max-w-prose border-l-2 border-primary/60 pl-4 leading-relaxed text-foreground">
              <span className="font-medium">Nuestra misión. </span>
              {profile.mission}
            </p>
          </section>

          <section aria-labelledby="que-hacemos" className="flex flex-col gap-4">
            <h2 id="que-hacemos" className={headingClass}>Qué hacemos</h2>
            <ul className="flex flex-col gap-3">
              {highlights.map((highlight) => (
                <li key={highlight} className="border-b border-border/60 pb-3 leading-relaxed text-muted-foreground last:border-b-0 last:pb-0">
                  {highlight}
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>

      {/* Vacancy seam: with no fixture the prototype says exactly that and
          points at the real public board; with fixtures it lists the company's
          own roles through the reusable card, whose company line stays plain
          text because the reader is already on the company's page. */}
      <section aria-labelledby="vacantes" className="flex flex-col gap-3 border-t border-border pt-10">
        <h2 id="vacantes" className={headingClass}>Vacantes</h2>
        {jobs.length === 0 ? (
          <>
            <p className="max-w-prose leading-relaxed text-muted-foreground">
              {profile.name} todavía no lista sus vacantes en esta página del prototipo. Mientras
              tanto, puedes revisar las vacantes publicadas en PeopleFlow.
            </p>
            <Link href="/vacantes" className={`self-start ${linkClass}`}>
              Ver vacantes publicadas
            </Link>
          </>
        ) : (
          <ul aria-label={`Vacantes en ${profile.name}`} className="mt-3 flex flex-col gap-4">
            {jobs.map((job) => (
              <VacancyCard key={job.id} job={job} />
            ))}
          </ul>
        )}
      </section>
    </article>
  );
}
