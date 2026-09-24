"use client";

import * as React from "react";
import { ArrowUpRight, Briefcase, CalendarClock, CalendarDays, Ellipsis, ExternalLink, FileText, FileX2, LayoutGrid, Link2Off, List, Search, Share2 } from "lucide-react";
import Link from "next/link";
import type { LucideIcon } from "lucide-react";

import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from "@/components/ui/item";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

import { APPLICATION_SOURCE_LABELS, APPLICATION_STATUSES, APPLICATION_STATUS_LABELS, countApplicationsByStatus } from "./portfolio-model";
import type { ApplicationStatus, CandidateApplicationView } from "./portfolio-model";

/**
 * Props-only, in-memory candidate applications workspace for
 * `/candidato/postulaciones`. Every filter count and the result list derive from
 * `applications`; the surface owns no fetch, storage, router mutation, form,
 * timer, randomness or candidate-side status change, and CDP-06B supplies the
 * frozen fixtures at the route boundary.
 *
 * Two presentations share the same IDs, order, facts and vacancy truth but not
 * the same composition: `cards` is a two-column desktop grid of rich vertical
 * Cards (identity header, status Badge, divided metadata, cover letter, dated
 * footer) and `list` is a one-column sequence of compact outline `Item` rows
 * (identity medallion, status/source, cover letter with both dates, action
 * menu) grouped by `ItemGroup`. See `docs/frontend-ui-design-rules.md` for the
 * durable composition rules.
 */
export type ApplicationsWorkspaceProps = Readonly<{ applications: readonly CandidateApplicationView[] }>;

/** Surface-local filter: `all` is not an application status, so it stays here. */
type StatusFilter = "all" | ApplicationStatus;

/** Surface-local view mode; presentational only, filtering stays authoritative. */
type ApplicationsView = "cards" | "list";

/** Plural filter labels in the approved order; row status text stays singular. */
const FILTER_LABELS: Readonly<Record<ApplicationStatus, string>> = { submitted: "Enviadas", in_review: "En revisión", hired: "Contratadas", rejected: "Rechazadas" };
const STATUS_FILTERS: readonly { readonly value: StatusFilter; readonly label: string }[] = [
  { value: "all", label: "Todas" },
  ...APPLICATION_STATUSES.map((status) => ({ value: status, label: FILTER_LABELS[status] })),
];

/**
 * Semantic status variant per application state: the Spanish label always
 * carries the meaning, and the shared Badge variant reinforces it through the
 * `--status-*` tokens. No raw color value or local tone recipe is authored here.
 */
const STATUS_VARIANT: Readonly<Record<ApplicationStatus, BadgeVariant>> = {
  submitted: "info",
  in_review: "review",
  hired: "success",
  rejected: "danger",
};

/** Diacritic- and case-insensitive needle, so "ACME" and "disenadora" both match. */
const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/gu, "").toLowerCase().trim();
/** Deterministic long-form Spanish date, always rendered in UTC. */
const DATE_FORMAT = new Intl.DateTimeFormat("es-MX", { dateStyle: "long", timeZone: "UTC" });
const formatDate = (value: string) => DATE_FORMAT.format(new Date(value));
/** Natural Spanish count: singular only for exactly one. */
const countLabel = (count: number, singular: string, plural: string) => `${count} ${count === 1 ? singular : plural}`;

/** Shared 40px hit target; the installed Button owns the visible focus ring. */
const TARGET = "min-h-10";
/** Filter chips: the installed Button variant, re-shaped into the approved pill. */
const FILTER = `rounded-full px-3.5 font-medium ${TARGET}`;
const FILTER_ON = "border-primary/60 bg-primary/12 text-foreground";
const FILTER_OFF = "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground";
/** 40px view-toggle target; the installed ToggleGroup owns the base styling. */
const VIEW_ITEM = `gap-1.5 px-3.5 ${TARGET}`;
/** Quiet field term: it never competes with the value it labels. */
const META = "text-[12.5px] font-medium text-muted-foreground";
/** Card metadata: one column on mobile, the approved two-column row from `sm`. */
const CARD_FACTS = "grid grid-cols-1 gap-x-6 gap-y-4 text-sm sm:grid-cols-2";
/**
 * Circular identity medallions. One contextual icon per application, sized per
 * presentation density so the two modes do not share a single geometry.
 */
const IDENTITY = { card: { box: "size-11", icon: "size-5" }, list: { box: "size-9", icon: "size-4" } } as const;

/**
 * Vacancy navigation keeps the anchor element and its link role: the shadcn
 * Button contract (variants, focus ring, `data-slot`) is applied to the Next
 * Link instead of routing it through the Base UI Button, which would relabel
 * the navigation as a non-native button.
 */
const VACANCY_LINK = buttonVariants({ variant: "outline", size: "sm" });

/** Bounded empty-state explanation that names the exact active search and/or filter. */
function emptyFilterDetail(query: string, status: StatusFilter): string {
  const term = query.trim();
  const statusLabel = status === "all" ? null : APPLICATION_STATUS_LABELS[status];
  if (term !== "" && statusLabel !== null) return `No hay postulaciones que coincidan con «${term}» y el estado ${statusLabel}.`;
  if (term !== "") return `No hay postulaciones que coincidan con «${term}».`;
  return `No hay postulaciones con el estado ${statusLabel ?? ""}.`;
}

/** One labelled fact: a functional icon with the quiet term, then the value. */
function FactLabel({ icon: Icon, children }: { readonly icon: LucideIcon; readonly children: React.ReactNode }) {
  return (
    <dt className={`flex items-center gap-1.5 ${META}`}>
      <Icon aria-hidden="true" className="size-3.5" />
      {children}
    </dt>
  );
}

/** Honest document icon: a letter exists, or it does not. */
function CoverLetterIcon({ hasLetter }: { readonly hasLetter: boolean }) {
  const className = "size-3.5 shrink-0 text-muted-foreground";
  return hasLetter ? <FileText aria-hidden="true" className={className} /> : <FileX2 aria-hidden="true" className={className} />;
}

/** Contextual identity medallion: the circular anchor of the application row. */
function ApplicationIdentity({ density }: { readonly density: keyof typeof IDENTITY }) {
  const { box, icon } = IDENTITY[density];
  return (
    <span data-pf-application-identity aria-hidden="true" className={`grid shrink-0 place-items-center rounded-full bg-primary/10 text-primary ${box}`}>
      <Briefcase className={icon} />
    </span>
  );
}

/** Status as text inside its semantic variant: the Spanish label carries the
    meaning and the shared decorative dot only supplements it. */
function ApplicationStatusBadge({ status }: { readonly status: ApplicationStatus }) {
  return <Badge variant={STATUS_VARIANT[status]} dot>{APPLICATION_STATUS_LABELS[status]}</Badge>;
}

/**
 * The status Badge in the card's upper-right slot. The visually hidden `dt`
 * keeps the name-value semantics of the status pair, so the status text never
 * travels as an unlabelled tone.
 */
function ApplicationStatusSlot({ status }: { readonly status: ApplicationStatus }) {
  return (
    <dl data-pf-application-status>
      <dt className="sr-only">Estado</dt>
      <dd><ApplicationStatusBadge status={status} /></dd>
    </dl>
  );
}

/** Cover letter block for the rich card: full width, wrapping, honest absence. */
function ApplicationCoverLetter({ application }: { readonly application: CandidateApplicationView }) {
  const hasLetter = application.coverLetter !== null;
  return (
    <div data-pf-application-cover-letter className="min-w-0">
      <dl className="flex flex-col gap-1.5">
        <dt className={`flex items-center gap-1.5 ${META}`}>
          <CoverLetterIcon hasLetter={hasLetter} />
          Carta de presentación
        </dt>
        <dd className={hasLetter ? "line-clamp-4 text-sm text-foreground" : "text-sm text-muted-foreground"}>
          {hasLetter ? application.coverLetter : "Sin carta de presentación"}
        </dd>
      </dl>
    </div>
  );
}

/** Exactly one `Ver vacante` link, or the honest historical note when the
    vacancy is no longer public. */
function ApplicationVacancy({ application }: { readonly application: CandidateApplicationView }) {
  if (application.publicJobHref === null) {
    return (
      <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <Link2Off aria-hidden="true" className="size-4 text-muted-foreground" />
        Vacante histórica sin enlace
      </p>
    );
  }
  return (
    <Link
      href={application.publicJobHref}
      data-slot="button"
      aria-label={`Ver vacante de ${application.jobTitle} en ${application.companyName}`}
      className={`${VACANCY_LINK} min-h-10`}
    >
      Ver vacante
      <ArrowUpRight aria-hidden="true" data-icon="inline-end" />
    </Link>
  );
}

/** One application as a rich vertical Card: identity header with the status
    Badge, divided metadata row, cover letter and a dated footer with the
    vacancy action. The grid parent owns the two-column desktop layout. */
function ApplicationCard({ application }: { readonly application: CandidateApplicationView }) {
  return (
    <Card data-pf-application-row={application.id} data-pf-application-presentation="card" className="h-full">
      <CardHeader className="border-b">
        <div className="flex min-w-0 items-start gap-3">
          <ApplicationIdentity density="card" />
          <div className="min-w-0">
            <CardTitle>
              <h3 className="font-heading text-base font-semibold text-foreground">{application.jobTitle}</h3>
            </CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">{application.companyName}</p>
          </div>
        </div>
        <CardAction><ApplicationStatusSlot status={application.status} /></CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <dl data-pf-application-metadata={application.id} className={CARD_FACTS}>
          <div>
            <FactLabel icon={Share2}>Fuente</FactLabel>
            <dd className="mt-1 text-foreground">{APPLICATION_SOURCE_LABELS[application.source]}</dd>
          </div>
          <div>
            <FactLabel icon={CalendarDays}>Postulada</FactLabel>
            <dd className="mt-1 text-foreground"><time dateTime={application.createdAt}>{formatDate(application.createdAt)}</time></dd>
          </div>
        </dl>
        <ApplicationCoverLetter application={application} />
      </CardContent>
      <CardFooter className="mt-auto flex-col items-start gap-3 border-t sm:flex-row sm:items-center sm:justify-between">
        <p className="flex items-center gap-1.5">
          <CalendarClock aria-hidden="true" className="size-4 text-muted-foreground" />
          <span className={META}>Actualizada</span>
          <time dateTime={application.updatedAt} className="text-sm text-foreground">{formatDate(application.updatedAt)}</time>
        </p>
        <ApplicationVacancy application={application} />
      </CardFooter>
    </Card>
  );
}

/**
 * The list-only row menu. Base UI owns the closed state, keyboard/typeahead,
 * Escape, focus return and the `aria-haspopup`/`aria-expanded` trigger wiring,
 * so this component adds no menu behavior of its own. The trigger is a real
 * 40px ghost icon Button carrying a row-specific accessible name, and the menu
 * exposes exactly one truthful item: a real Next Link for a live vacancy, or a
 * single disabled item when the vacancy is no longer public. No menu action
 * withdraws, mutates status, persists or touches the network.
 */
function ApplicationRowMenu({ application }: { readonly application: CandidateApplicationView }) {
  const menuLabel = `Acciones de la postulación de ${application.jobTitle} en ${application.companyName}`;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button type="button" variant="ghost" size="icon" className="size-10" aria-label={menuLabel} />}>
        <Ellipsis aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="bottom" className="min-w-44">
        <DropdownMenuGroup>
          {application.publicJobHref === null ? (
            <DropdownMenuItem disabled className="min-h-10">
              <Link2Off aria-hidden="true" />
              Vacante histórica sin enlace
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem className="min-h-10" render={<Link href={application.publicJobHref} />}>
              <ExternalLink aria-hidden="true" />
              Ver vacante
            </DropdownMenuItem>
          )}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * One application as an independent list row. The presentation marker stays on
 * the semantic `<li>`, while `Item` supplies that row's own rounded surface.
 * The official Item anatomy gives every row four stable desktop zones: the
 * identity medallion in `ItemMedia`, one responsive information grid inside
 * `ItemContent` (`ItemTitle`/`ItemDescription` for identity, then status/source
 * and the cover-letter dates), and the compact action menu in `ItemActions`.
 * Where the zones cannot share one line the row stacks in source order; on
 * narrow screens `ItemActions` leaves the flex track entirely and anchors to
 * the `relative` Item's top-right corner, so identity, cover-letter and date
 * values keep the full row width, and the cover-letter label stacks over its
 * wrapping value until the approved single-line truncation returns at `sm`.
 */
function ApplicationListItem({ application }: { readonly application: CandidateApplicationView }) {
  const hasLetter = application.coverLetter !== null;
  return (
    <li data-pf-application-row={application.id} data-pf-application-presentation="list" className="min-w-0">
      <Item variant="outline" data-pf-application-row-surface={application.id} className="relative min-w-0 items-start">
        <ItemMedia>
          <ApplicationIdentity density="list" />
        </ItemMedia>
        <ItemContent className="min-w-0">
          <div className="grid grid-cols-1 gap-x-6 gap-y-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)_minmax(0,1.6fr)]">
            {/* Only the identity cell reserves the anchored trigger band (the
                40px target plus the Item gap), so the cover letter and both
                dates below it keep the full mobile row width. */}
            <div className="min-w-0 pr-14 sm:pr-0">
              <ItemTitle className="max-w-full">{application.jobTitle}</ItemTitle>
              <ItemDescription>{application.companyName}</ItemDescription>
            </div>
            <dl className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <dt className={META}>Estado</dt>
                <dd><ApplicationStatusBadge status={application.status} /></dd>
              </div>
              <div className="flex items-center gap-1.5">
                <FactLabel icon={Share2}>Fuente</FactLabel>
                <dd className="text-[13px] text-foreground">{APPLICATION_SOURCE_LABELS[application.source]}</dd>
              </div>
            </dl>
            <div className="flex min-w-0 flex-col gap-1.5">
              {/* The label owns its own line on narrow screens and the value
                  wraps below it; the approved single-line truncation only
                  returns at `sm` and wider. */}
              <div className="flex min-w-0 flex-col gap-1 sm:flex-row sm:items-center sm:gap-1.5">
                <p className={`flex shrink-0 items-center gap-1.5 ${META}`}>
                  <CoverLetterIcon hasLetter={hasLetter} />
                  Carta de presentación
                </p>
                <span className="min-w-0 text-[13px] text-muted-foreground sm:truncate">{hasLetter ? application.coverLetter : "Sin carta de presentación"}</span>
              </div>
              <dl className="flex flex-wrap items-center gap-x-4 gap-y-1">
                <div className="flex items-center gap-1.5">
                  <FactLabel icon={CalendarDays}>Postulada</FactLabel>
                  <dd className="text-[13px] text-foreground"><time dateTime={application.createdAt}>{formatDate(application.createdAt)}</time></dd>
                </div>
                <div className="flex items-center gap-1.5">
                  <FactLabel icon={CalendarClock}>Actualizada</FactLabel>
                  <dd className="text-[13px] text-foreground"><time dateTime={application.updatedAt}>{formatDate(application.updatedAt)}</time></dd>
                </div>
              </dl>
            </div>
          </div>
        </ItemContent>
        <ItemActions className="absolute right-4 top-3.5 shrink-0 sm:static">
          <ApplicationRowMenu application={application} />
        </ItemActions>
      </Item>
    </li>
  );
}

/** Searchable, status-filtered applications surface over the passed props. */
export function ApplicationsWorkspace({ applications }: ApplicationsWorkspaceProps) {
  const [query, setQuery] = React.useState("");
  const [status, setStatus] = React.useState<StatusFilter>("all");
  const [view, setView] = React.useState<ApplicationsView>("cards");
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
    <div data-pf-applications-workspace className="mx-auto w-full max-w-screen-2xl flex flex-col gap-5 px-4 py-4 lg:px-6">
      <header data-pf-applications-intro className="flex flex-col gap-2">
        <h2 className="font-heading text-2xl font-semibold tracking-tight text-foreground">Postulaciones</h2>
      </header>
      <Card data-pf-applications-filters>
        <CardContent className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="applications-search" className="text-[12.5px] font-medium text-foreground">Buscar por puesto o empresa</label>
            {/* `h-11` keeps the real control at or above 40px: the group's 1px border
                leaves a 42px inner box for the `h-full` input. */}
            <InputGroup className="h-11 w-full lg:w-72">
              <InputGroupAddon>
                <Search aria-hidden="true" />
              </InputGroupAddon>
              <InputGroupInput
                id="applications-search"
                data-pf-applications-search
                type="search"
                className="h-full"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Puesto o empresa"
              />
            </InputGroup>
          </div>
          <div role="group" aria-label="Filtrar por estado" className="flex w-full flex-nowrap items-center gap-2 overflow-x-auto pb-1 md:flex-wrap md:overflow-visible lg:w-auto">
            {STATUS_FILTERS.map((item) => {
              const active = status === item.value;
              return (
                <Button
                  key={item.value}
                  type="button"
                  variant="outline"
                  data-pf-applications-filter={item.value}
                  aria-pressed={active}
                  onClick={() => setStatus(item.value)}
                  className={`${FILTER} ${active ? FILTER_ON : FILTER_OFF}`}
                >
                  {item.label}<span className="rounded-full bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground tabular-nums">{filterCounts[item.value]}</span>
                </Button>
              );
            })}
          </div>
        </CardContent>
      </Card>
      <div data-pf-applications-toolbar className="flex flex-wrap items-center justify-between gap-3">
        <p role="status" aria-live="polite" data-pf-applications-count className="text-sm text-muted-foreground">
          {`Mostrando ${countLabel(filtered.length, "postulación", "postulaciones")}`}
        </p>
        <ToggleGroup
          aria-label="Vista de postulaciones"
          variant="outline"
          spacing={0}
          value={[view]}
          onValueChange={(next: string[]) => {
            // Base UI can emit an empty array when the active item is toggled off; ignore it so one view stays selected.
            const [nextView] = next;
            if (nextView === "cards" || nextView === "list") setView(nextView);
          }}
        >
          <ToggleGroupItem value="cards" data-pf-applications-view-option="cards" aria-label="Vista de tarjetas" className={VIEW_ITEM}>
            <LayoutGrid aria-hidden="true" />Tarjetas
          </ToggleGroupItem>
          <ToggleGroupItem value="list" data-pf-applications-view-option="list" aria-label="Vista de lista" className={VIEW_ITEM}>
            <List aria-hidden="true" />Lista
          </ToggleGroupItem>
        </ToggleGroup>
      </div>
      <div data-pf-applications-results data-pf-applications-view={view} className="flex flex-col gap-4">
        {filtered.length === 0 ? (
          <Empty data-pf-applications-empty className="border border-dashed border-border bg-card p-6">
            <EmptyHeader>
              <EmptyTitle>{hasApplications ? "Sin resultados" : "Todavía no tienes postulaciones"}</EmptyTitle>
              <EmptyDescription>{hasApplications ? emptyFilterDetail(query, status) : "Cuando te postules a una vacante, tu postulación va a aparecer en este listado."}</EmptyDescription>
            </EmptyHeader>
            {hasApplications && filtersActive && (
              <EmptyContent>
                <Button type="button" variant="outline" data-pf-applications-clear onClick={clearFilters} className={`rounded-full px-3.5 font-medium ${TARGET}`}>Limpiar filtros</Button>
              </EmptyContent>
            )}
          </Empty>
        ) : view === "cards" ? (
          <div data-pf-applications-cards className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {filtered.map((application) => (<ApplicationCard key={application.id} application={application} />))}
          </div>
        ) : (
          // The group wrapper is presentational and the real `<ul>` keeps the
          // list role: ItemGroup ships `role="list"` for `Item` div children,
          // but duplicating that role over a `<ul>` would leave the wrapper's
          // required `listitem` children missing and fail `aria-required-children`.
          <ItemGroup role="presentation">
            <ul data-pf-applications-list className="flex flex-col gap-3">
              {filtered.map((application) => (<ApplicationListItem key={application.id} application={application} />))}
            </ul>
          </ItemGroup>
        )}
      </div>
    </div>
  );
}
