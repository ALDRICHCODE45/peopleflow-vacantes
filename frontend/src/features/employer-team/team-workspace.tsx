"use client";

import * as React from "react";
import { Ellipsis, SearchIcon, Users } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { StateCard } from "@/components/feedback/state-card";
import type { DraftListRow } from "@/features/jobs/drafts/list/client";
import { cn } from "@/lib/utils";
import { TEAM_MEMBER_ROLE_LABELS, type TeamMemberRole } from "./model";
import { memberName, memberRowActions, memberWorkload, type CompanyMember, type MemberRowAction } from "./members-model";

const META = "text-[12.5px] text-muted-foreground";
const GRID_COLUMNS = "lg:grid-cols-[minmax(0,2.4fr)_minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,1.6fr)_2.5rem]";
const GRID = cn("grid grid-cols-1 gap-3 px-4 py-4 sm:px-5 lg:items-center lg:gap-4", GRID_COLUMNS);
const HEADER = cn("hidden items-center gap-4 border-b border-border px-5 py-3 text-[12px] font-semibold tracking-wide text-muted-foreground uppercase lg:grid", GRID_COLUMNS);
const NARROW_LABEL = "text-[11px] font-semibold tracking-wide text-muted-foreground uppercase lg:sr-only";
const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/gu, "").toLowerCase().trim();
const initials = (name: string) => name.split(/\s+/u).slice(0, 2).map(word => word.charAt(0)).join("").toUpperCase();
const plural = (count: number, singular: string, pluralForm: string) => `${count} ${count === 1 ? singular : pluralForm}`;
const dateFormat = new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short", year: "numeric", timeZone: "America/Mexico_City" });
const workloadCopy = (workload: NonNullable<ReturnType<typeof memberWorkload>>) => workload.ownedVacancies === 0
  ? "Sin vacantes asignadas"
  : `${plural(workload.ownedVacancies, "vacante", "vacantes")} · ${plural(workload.inProcessCandidates, "candidato", "candidatos")} en proceso`;

type Props = {
  members: readonly CompanyMember[];
  drafts?: readonly DraftListRow[];
  workloadPending?: boolean;
  workloadUnavailable?: boolean;
  role?: TeamMemberRole | null;
  userId?: string | null;
  disabled?: boolean;
  loading?: boolean;
  onAction?: (member: CompanyMember, action: MemberRowAction) => void;
  feedback?: React.ReactNode;
  actionStatusId?: string;
};

/** Existing row layout, now over the strict server read. The menu follows shadcn Basic
 * (Trigger render=Button → Content → Group → Item); avatars have no invented image. */
export function TeamWorkspace({ members, drafts = [], workloadPending = false, workloadUnavailable = false, role = null, userId = null, disabled = false, loading = false, onAction, feedback, actionStatusId }: Props) {
  const [query, setQuery] = React.useState("");
  const needle = normalize(query);
  const results = members.filter(member => normalize(memberName(member)).includes(needle) || normalize(member.user?.email ?? "").includes(needle));
  const cards = [
    { key: "total", singular: "Miembro", plural: "Miembros", value: members.length },
    { key: "owners", singular: "Dueño", plural: "Dueños", value: members.filter(member => member.role === "owner").length },
    { key: "recruiters", singular: "Reclutador", plural: "Reclutadores", value: members.filter(member => member.role === "recruiter").length },
  ];
  return (
    <div data-pf-team-workspace aria-busy={loading || undefined} className="flex flex-col gap-5">
      {loading && <span role="status" className="sr-only">Cargando equipo</span>}
      <section data-pf-team-summary aria-label="Resumen del equipo" className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {cards.map(card => (
          <Card key={card.key} data-pf-team-metric={card.key} size="sm">
            <CardHeader>
              <CardTitle>{loading ? <Skeleton aria-hidden="true" className="h-7 w-10" /> : <h3 className="text-[22px] font-bold tabular-nums">{card.value}</h3>}</CardTitle>
              <CardDescription>{loading ? <Skeleton aria-hidden="true" className="h-5 w-24" /> : card.value === 1 ? card.singular : card.plural}</CardDescription>
            </CardHeader>
          </Card>
        ))}
      </section>
      <div className="flex flex-col gap-3 border-b border-border pb-4 lg:flex-row lg:items-end lg:justify-between">
        <Field className="lg:w-72">
          <FieldLabel htmlFor="team-workspace-search">Buscar miembro</FieldLabel>
          <div className="relative">
            <SearchIcon aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input id="team-workspace-search" data-pf-team-search type="search" value={query} disabled={loading} onChange={event => setQuery(event.target.value)} placeholder="Buscar por nombre o correo…" className="h-10 pl-9" />
          </div>
        </Field>
      </div>
      {feedback}
      <div data-pf-team-count role={loading ? undefined : "status"} aria-live="polite" className={META}>{loading ? <Skeleton aria-hidden="true" className="h-4 w-24" /> : plural(results.length, "miembro", "miembros")}</div>
      {!loading && results.length === 0 ? (
        <StateCard icon={Users} tone="empty" title={members.length === 0 ? "Todavía no hay miembros del equipo" : "Sin resultados"}
          description={members.length === 0 ? "Aquí se mostrarán las personas de tu equipo y su carga de trabajo." : "No hay miembros que coincidan con la búsqueda. Limpia la búsqueda para volver a ver tu equipo."}
          primaryAction={members.length > 0 ? { label: "Limpiar búsqueda", onClick: () => setQuery("") } : undefined} />
      ) : <Card data-pf-team-results>
        {/* The existing visual column header stays unchanged; this title names the list for AT. */}
        <CardHeader className="sr-only"><CardTitle><h2>Miembros del equipo</h2></CardTitle><CardDescription>Personas, roles y carga de trabajo</CardDescription></CardHeader>
        <CardContent className="-mx-(--card-spacing)">
          <div data-pf-team-header aria-hidden="true" className={HEADER}><span>Miembro</span><span>Rol</span><span>Antigüedad</span><span>Carga</span><span /></div>
          {loading ? <ul aria-hidden="true" className="divide-y divide-border">{[0, 1, 2].map(key => <li key={key} className={GRID}>
            <div className="flex items-start gap-3"><Skeleton className="size-10 shrink-0 rounded-full" /><div className="flex min-w-0 flex-col gap-2"><Skeleton className="h-5 w-32" /><Skeleton className="h-4 w-40" /></div></div>
            <Skeleton className="h-5 w-20" /><Skeleton className="h-4 w-32" /><Skeleton className="h-4 w-full" /><span />
          </li>)}</ul> : <ul data-pf-team-list className="divide-y divide-border">{results.map(member => {
            const name = memberName(member);
            const workload = workloadUnavailable ? null : memberWorkload(member, drafts);
            const actions = memberRowActions(member, members, role, userId);
            return <li key={member.id} data-pf-team-row={member.id} className={GRID}>
              <div className="flex min-w-0 items-start gap-3">
                <Avatar data-pf-team-avatar={member.id} aria-hidden="true" size="lg"><AvatarFallback>{initials(name)}</AvatarFallback></Avatar>
                <div className="min-w-0"><p className="break-words text-[14.5px] font-semibold text-foreground">{name}</p>{member.user && <p className={cn(META, "mt-0.5 break-all")}>{member.user.email}</p>}</div>
              </div>
              <div className="min-w-0"><span className={NARROW_LABEL}>Rol</span><div className="mt-0.5 lg:mt-0"><Badge variant={member.role === "owner" ? "accent" : "secondary"}>{TEAM_MEMBER_ROLE_LABELS[member.role]}</Badge></div></div>
              <time dateTime={member.created_at} className={META}>Miembro desde {dateFormat.format(new Date(member.created_at))}</time>
              <div data-pf-team-workload aria-busy={workloadPending || undefined} className="min-w-0">
                <span className={NARROW_LABEL}>Carga</span>
                {workloadPending ? <><span className="sr-only">Cargando carga de trabajo</span><Skeleton aria-hidden="true" className="h-4 w-full" /></> : <p className={cn(META, "mt-0.5 lg:mt-0")}>{workload ? workloadCopy(workload) : "Carga no disponible"}</p>}
              </div>
              <div className="flex justify-end">{actions.length > 0 && onAction && <DropdownMenu>
                <DropdownMenuTrigger disabled={disabled} aria-label={`Acciones de ${name}`} aria-describedby={actionStatusId} render={<Button type="button" variant="ghost" size="icon" className="size-10" />}><Ellipsis aria-hidden="true" /></DropdownMenuTrigger>
                <DropdownMenuContent align="end"><DropdownMenuGroup>{actions.map(action => <React.Fragment key={action.kind}>
                  {action.kind === "remove" && <DropdownMenuSeparator />}
                  <DropdownMenuItem className="min-h-10" variant={action.kind === "remove" ? "destructive" : "default"} disabled={disabled} onClick={() => onAction(member, action)}>{action.label}</DropdownMenuItem>
                </React.Fragment>)}</DropdownMenuGroup></DropdownMenuContent>
              </DropdownMenu>}</div>
            </li>;
          })}</ul>}
        </CardContent>
      </Card>}
    </div>
  );
}
