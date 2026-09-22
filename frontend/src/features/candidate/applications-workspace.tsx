"use client";

import * as React from "react";
import Link from "next/link";

import { APPLICATION_SOURCE_LABELS, APPLICATION_STATUSES, APPLICATION_STATUS_LABELS, countApplicationsByStatus } from "./portfolio-model";
import type { ApplicationStatus, CandidateApplicationView } from "./portfolio-model";

/**
 * Props-only, in-memory candidate applications workspace for
 * `/candidato/postulaciones`. Every filter count and the result list derive from
 * `applications`; the surface owns no fetch, storage, router mutation, form,
 * timer, randomness or candidate-side status change, and CDP-06B supplies the
 * frozen fixtures at the route boundary.
 */
export type ApplicationsWorkspaceProps = Readonly<{ applications: readonly CandidateApplicationView[] }>;

/** Surface-local filter: `all` is not an application status, so it stays here. */
type StatusFilter = "all" | ApplicationStatus;

/** Plural filter labels in the approved order; row status text stays singular. */
const FILTER_LABELS: Readonly<Record<ApplicationStatus, string>> = { submitted: "Enviadas", in_review: "En revisión", hired: "Contratadas", rejected: "Rechazadas" };
const STATUS_FILTERS: readonly { readonly value: StatusFilter; readonly label: string }[] = [
  { value: "all", label: "Todas" },
  ...APPLICATION_STATUSES.map((status) => ({ value: status, label: FILTER_LABELS[status] })),
];

/** Supplemental status color; the Spanish status text always carries the meaning. */
const STATUS_DOT: Readonly<Record<ApplicationStatus, string>> = { submitted: "bg-chart-3", in_review: "bg-primary", hired: "bg-chart-2", rejected: "bg-destructive" };

/** Diacritic- and case-insensitive needle, so "ACME" and "disenadora" both match. */
const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/gu, "").toLowerCase().trim();
/** Deterministic long-form Spanish date, always rendered in UTC. */
const DATE_FORMAT = new Intl.DateTimeFormat("es-MX", { dateStyle: "long", timeZone: "UTC" });
const formatDate = (value: string) => DATE_FORMAT.format(new Date(value));
/** Natural Spanish count: singular only for exactly one. */
const countLabel = (count: number, singular: string, plural: string) => `${count} ${count === 1 ? singular : plural}`;

/** Shared 40px hit target with a visible focus ring, for filters, clear and links. */
const TARGET = "min-h-10 outline-hidden transition-colors duration-200 focus-visible:ring-3 focus-visible:ring-ring/50";
const FILTER = `inline-flex items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium ${TARGET}`;
const SEARCH = "h-10 w-full rounded-md border border-input bg-transparent px-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-ring/50 lg:w-72";
const LINK = `inline-flex items-center rounded-md px-2 text-sm font-medium text-primary underline-offset-4 hover:text-primary/80 hover:underline ${TARGET}`;
/** Mobile single-column stacking; the fact grid becomes four desktop columns. */
const FACTS = "grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-4";
const META = "text-[12.5px] text-muted-foreground";

/** Bounded empty-state explanation that names the exact active search and/or filter. */
function emptyFilterDetail(query: string, status: StatusFilter): string {
  const term = query.trim();
  const statusLabel = status === "all" ? null : APPLICATION_STATUS_LABELS[status];
  if (term !== "" && statusLabel !== null) return `No hay postulaciones que coincidan con «${term}» y el estado ${statusLabel}.`;
  if (term !== "") return `No hay postulaciones que coincidan con «${term}».`;
  return `No hay postulaciones con el estado ${statusLabel ?? ""}.`;
}

/** One application as a non-clickable list row: every candidate fact in text,
    plus exactly one `Ver vacante` link or the honest historical note. */
function ApplicationRow({ application }: { readonly application: CandidateApplicationView }) {
  return (
    <li data-pf-application-row={application.id} className="flex flex-col gap-3 px-4 py-4 sm:px-5">
      <div className="min-w-0">
        <p className="text-[15px] font-semibold text-foreground">{application.jobTitle}</p>
        <p className="mt-0.5 text-sm text-muted-foreground">{application.companyName}</p>
      </div>
      <dl className={FACTS}>
        <div>
          <dt className={META}>Estado</dt>
          <dd className="inline-flex items-center gap-2 text-foreground">
            <span aria-hidden="true" className={`size-2 rounded-full ${STATUS_DOT[application.status]}`} />
            {APPLICATION_STATUS_LABELS[application.status]}
          </dd>
        </div>
        <div><dt className={META}>Fuente</dt><dd className="text-foreground">{APPLICATION_SOURCE_LABELS[application.source]}</dd></div>
        <div><dt className={META}>Postulada</dt><dd className="text-foreground"><time dateTime={application.createdAt}>{formatDate(application.createdAt)}</time></dd></div>
        <div><dt className={META}>Actualizada</dt><dd className="text-foreground"><time dateTime={application.updatedAt}>{formatDate(application.updatedAt)}</time></dd></div>
      </dl>
      <div>
        <p className={META}>Carta de presentación</p>
        {application.coverLetter === null
          ? <p className="text-sm text-muted-foreground">Sin carta de presentación</p>
          : <p className="line-clamp-3 text-sm text-foreground">{application.coverLetter}</p>}
      </div>
      <div>
        {application.publicJobHref === null
          ? <p className="text-sm text-muted-foreground">Vacante histórica sin enlace</p>
          : <Link href={application.publicJobHref} aria-label={`Ver vacante de ${application.jobTitle} en ${application.companyName}`} className={LINK}>Ver vacante</Link>}
      </div>
    </li>
  );
}

/** Searchable, status-filtered applications surface over the passed props. */
export function ApplicationsWorkspace({ applications }: ApplicationsWorkspaceProps) {
  const [query, setQuery] = React.useState("");
  const [status, setStatus] = React.useState<StatusFilter>("all");
  const counts = countApplicationsByStatus(applications);
  const filterCounts: Readonly<Record<StatusFilter, number>> = { all: applications.length, ...counts };
  const needle = normalize(query);
  const filtered = [...applications]
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .filter((application) => (status === "all" || application.status === status) && (needle === "" || normalize(`${application.jobTitle} ${application.companyName}`).includes(needle)));
  const filtersActive = query.trim() !== "" || status !== "all";
  const hasApplications = applications.length > 0;
  const clearFilters = () => { setQuery(""); setStatus("all"); };

  return (
    <div data-pf-applications-workspace className="flex flex-col gap-5 px-4 py-4 lg:px-6">
      <p role="note" data-pf-applications-disclosure className="max-w-3xl text-sm text-muted-foreground">
        Demo local de solo lectura: no puedes retirar postulaciones ni cambiar su estado, no hay contacto con reclutadores y no se guarda nada ni se envía información.
      </p>
      <div className="flex flex-col gap-3 border-b border-border pb-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="applications-search" className="text-[12.5px] font-medium text-foreground">Buscar por puesto o empresa</label>
          <input id="applications-search" data-pf-applications-search type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Puesto o empresa" className={SEARCH} />
        </div>
        <div role="group" aria-label="Filtrar por estado" className="flex flex-wrap items-center gap-2">
          {STATUS_FILTERS.map((item) => {
            const active = status === item.value;
            return (
              <button key={item.value} type="button" data-pf-applications-filter={item.value} aria-pressed={active} onClick={() => setStatus(item.value)} className={`${FILTER} ${active ? "border-primary/60 bg-primary/12 text-foreground" : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground"}`}>
                {item.label}
                <span className="rounded-full bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground tabular-nums">{filterCounts[item.value]}</span>
              </button>
            );
          })}
        </div>
      </div>
      <p role="status" aria-live="polite" data-pf-applications-count className="text-sm text-muted-foreground">
        {`Mostrando ${countLabel(filtered.length, "postulación", "postulaciones")}`}
      </p>
      <div data-pf-applications-results className="overflow-hidden rounded-2xl border border-border bg-card/40">
        {filtered.length === 0 ? (
          <div data-pf-applications-empty className="flex flex-col items-start gap-3 p-4 sm:p-6">
            <p className="font-heading text-base font-semibold text-foreground">{hasApplications ? "Sin resultados" : "Todavía no tienes postulaciones"}</p>
            <p className="max-w-xl text-sm text-muted-foreground">{hasApplications ? emptyFilterDetail(query, status) : "Cuando te postules a una vacante, tu postulación va a aparecer en este listado."}</p>
            {hasApplications && filtersActive && (
              <button type="button" data-pf-applications-clear onClick={clearFilters} className={`${FILTER} border-border text-foreground hover:border-primary/40`}>Limpiar filtros</button>
            )}
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {filtered.map((application) => (<ApplicationRow key={application.id} application={application} />))}
          </ul>
        )}
      </div>
    </div>
  );
}
