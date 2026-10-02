"use client";

import * as React from "react";
import { SearchIcon } from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import { TEAM_MEMBER_ROLE_LABELS, TEAM_MEMBER_STATUS_LABELS, summarizeTeam } from "./model";
import type { TeamMember, TeamMemberStatus } from "./model";

/** Status filter: `all` is not a member status, so it stays surface-local. */
type StatusFilter = "all" | TeamMemberStatus;

const STATUS_FILTERS: ReadonlyArray<{ value: StatusFilter; label: string }> = [
  { value: "all", label: "Todas" }, { value: "active", label: "Activas" }, { value: "invited", label: "Pendientes" },
];
/** Member-status variant: the label text always carries the meaning and the
    shared Badge variant only supplements it. */
const STATUS_VARIANT: Readonly<Record<TeamMemberStatus, BadgeVariant>> = { active: "success", invited: "review" };

const FOCUS = "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 focus-visible:outline-none";
const FILTER = `inline-flex min-h-10 items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium transition-colors duration-200 ${FOCUS}`;
const META = "text-[12.5px] text-muted-foreground";
const CELL = "min-w-0";
const GRID = "grid grid-cols-1 gap-3 px-4 py-4 sm:px-5 lg:grid-cols-[minmax(0,2.4fr)_minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,1.6fr)] lg:items-center lg:gap-4";
const HEADER = "hidden grid-cols-[minmax(0,2.4fr)_minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,1.6fr)] items-center gap-4 border-b border-border px-5 py-3 text-[12px] font-semibold tracking-wide text-muted-foreground uppercase lg:grid";
/** Narrow-visible fact label: visually hidden at desktop, never removed from the accessibility tree. */
const NARROW_LABEL = "text-[11px] font-semibold tracking-wide text-muted-foreground uppercase lg:sr-only";

/** Diacritic- and case-insensitive needle, so "LUCIA" and "lucía" both match. */
const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/gu, "").toLowerCase().trim();
/** Two-letter monogram of a member name; purely decorative next to the full name. */
const initials = (name: string) => name.split(/\s+/u).slice(0, 2).map((word) => word.charAt(0)).join("").toUpperCase();
/** Spanish count agreement: singular for exactly one, plural otherwise. */
const plural = (count: number, singular: string, pluralForm: string) => `${count} ${count === 1 ? singular : pluralForm}`;
/** In-process copy kept separate so a nonzero count can never be hidden by the vacancy copy. */
const inProcessCopy = (count: number) => `${plural(count, "candidato", "candidatos")} en proceso`;
/** Truthful workload copy: only a 0/0 member reads exactly "Sin vacantes asignadas". */
const workloadCopy = (workload: TeamMember["workload"]) => workload.ownedVacancies === 0
  ? workload.inProcessCandidates === 0 ? "Sin vacantes asignadas" : `Sin vacantes asignadas · ${inProcessCopy(workload.inProcessCandidates)}`
  : `${plural(workload.ownedVacancies, "vacante", "vacantes")} · ${inProcessCopy(workload.inProcessCandidates)}`;
/** Name or email match against the normalized needle. */
const matchesQuery = (member: TeamMember, needle: string) => normalize(member.fullName).includes(needle) || normalize(member.email).includes(needle);

/**
 * One member as a non-clickable list row: the truthful facts and the status
 * meaning in text, with the avatar and status dot as decorative supplements.
 * The row is never a link or a button and holds zero interactive descendants.
 */
function TeamMemberRow({ member }: { member: TeamMember }) {
  return (
    <li data-pf-team-row={member.id} className={GRID}>
      <div className={cn(CELL, "flex items-start gap-3")}>
        <Avatar data-pf-team-avatar={member.id} aria-hidden="true" size="lg">
          <AvatarFallback>{initials(member.fullName)}</AvatarFallback>
        </Avatar>
        <div className={CELL}>
          <p className="truncate text-[14.5px] font-semibold text-foreground">{member.fullName}</p>
          <p className={cn(META, "mt-0.5 truncate")}>{member.email}</p>
        </div>
      </div>
      <div className={CELL}>
        <span className={NARROW_LABEL}>Rol</span>
        <p className="mt-0.5 text-[13px] text-foreground lg:mt-0">{TEAM_MEMBER_ROLE_LABELS[member.role]}</p>
      </div>
      <div className={CELL}>
        <span className={NARROW_LABEL}>Estado</span>
        <div className="mt-0.5 lg:mt-0">
          <Badge variant={STATUS_VARIANT[member.status]} dot>
            {TEAM_MEMBER_STATUS_LABELS[member.status]}
          </Badge>
        </div>
      </div>
      <div className={CELL}>
        <span className={NARROW_LABEL}>Carga</span>
        <p className={cn(META, "mt-0.5 lg:mt-0")}>{workloadCopy(member.workload)}</p>
      </div>
    </li>
  );
}

/**
 * Employer team workspace: a fully local, read-only client surface over the
 * validated members it receives as props. It derives its four metrics from the
 * model helper, composes a labelled name/email search with the status filters,
 * and renders one truthful row per filtered member in input order. It owns no
 * fetch, router, auth/session, storage, or mutation, offers no invitation
 * affordance or member-detail link yet, and it never imports the Nexo fixture:
 * fixtures arrive as props.
 */
export function TeamWorkspace({ members }: { members: readonly TeamMember[] }) {
  const [query, setQuery] = React.useState("");
  const [status, setStatus] = React.useState<StatusFilter>("all");
  const summary = summarizeTeam(members);
  const counts: Readonly<Record<StatusFilter, number>> = { all: summary.total, active: summary.active, invited: summary.invited };
  const cards = [
    { key: "total", singular: "Miembro", plural: "Miembros", value: summary.total },
    { key: "owners", singular: "Propietario", plural: "Propietarios", value: summary.owners },
    { key: "recruiters", singular: "Reclutador", plural: "Reclutadores", value: summary.recruiters },
    { key: "invited", singular: "Invitación pendiente", plural: "Invitaciones pendientes", value: summary.invited },
  ] as const;
  const needle = normalize(query);
  const results = members.filter((member) => (status === "all" || member.status === status) && (needle === "" || matchesQuery(member, needle)));
  const filtersActive = query.trim() !== "" || status !== "all";
  const clearFilters = () => { setQuery(""); setStatus("all"); };
  return (
    <div data-pf-team-workspace className="flex flex-col gap-5">
      <section data-pf-team-summary aria-label="Resumen del equipo" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {cards.map((card) => (
          <div key={card.key} data-pf-team-metric={card.key} className="rounded-xl border border-border bg-card/50 p-4">
            <p className="font-heading text-[22px] font-bold text-foreground tabular-nums">{card.value}</p>
            <p className={META}>{card.value === 1 ? card.singular : card.plural}</p>
          </div>
        ))}
      </section>
      <div className="flex flex-col gap-3 border-b border-border pb-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="team-workspace-search" className="text-[12.5px] font-medium text-foreground">Buscar miembro</label>
          <div className="relative">
            <SearchIcon aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input id="team-workspace-search" data-pf-team-search type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar por nombre o correo…" className="h-10 pl-9 lg:w-72" />
          </div>
        </div>
        <div role="group" aria-label="Filtrar por estado" className="flex flex-wrap items-center gap-2">
          {STATUS_FILTERS.map((filter) => {
            const active = status === filter.value;
            return (
              <button key={filter.value} type="button" data-pf-team-filter={filter.value} aria-pressed={active} onClick={() => setStatus(filter.value)} className={cn(FILTER, active ? "border-primary/60 bg-primary/12 text-foreground" : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground")}>
                {filter.label}
                <span className="rounded-full bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground tabular-nums">{counts[filter.value]}</span>
              </button>
            );
          })}
        </div>
      </div>
      <p data-pf-team-count role="status" aria-live="polite" className={META}>{plural(results.length, "miembro", "miembros")}</p>
      <div data-pf-team-results className="overflow-hidden rounded-2xl border border-border bg-card/40">
        <div data-pf-team-header aria-hidden="true" className={HEADER}>
          <span>Miembro</span><span>Rol</span><span>Estado</span><span>Carga</span>
        </div>
        {results.length === 0 ? (
          <div className="p-4">
            <Empty data-pf-team-empty className="border border-border bg-card/40">
              <EmptyHeader>
                <EmptyMedia variant="icon"><SearchIcon aria-hidden="true" /></EmptyMedia>
                <EmptyTitle>{members.length === 0 ? "Todavía no hay miembros del equipo" : "Sin resultados"}</EmptyTitle>
                <EmptyDescription>{members.length === 0 ? "Cuando alguien se sume al equipo va a aparecer en este listado." : "No hay miembros que coincidan con la búsqueda y el estado seleccionados."}</EmptyDescription>
              </EmptyHeader>
              {filtersActive && members.length > 0 && (
                <EmptyContent>
                  <Button type="button" variant="outline" data-pf-team-clear onClick={clearFilters} className="min-h-10">Limpiar filtros</Button>
                </EmptyContent>
              )}
            </Empty>
          </div>
        ) : (
          <ul data-pf-team-list className="divide-y divide-border">
            {results.map((member) => (<TeamMemberRow key={member.id} member={member} />))}
          </ul>
        )}
      </div>
    </div>
  );
}
