"use client";

import { Search, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { CandidatePicker, type Participation } from "./candidate-picker";
import type { Filters, ScopeFilter } from "./rows";

const SCOPES: [ScopeFilter, string][] = [["all", "Todos"], ["vacancy", "Vacante"], ["candidates", "Candidatos"]];
const initials = (name: string) => name.split(/\s+/).slice(0, 2).map(word => word[0]).join("").toUpperCase();

/** S8/S13: Todos · Vacante · Candidatos, the «Candidato» selector (disabled for «Vacante»), the name search and the active-filter chip. */
export function DocumentFilters({ filters, counts, participations, onScope, onCandidate, onSearch, actions }: {
  filters: Filters; counts: { all: number | null; vacancy: number; candidates: number | null }; participations: Participation[];
  onScope: (scope: ScopeFilter) => void; onCandidate: (participationId: string | null) => void; onSearch: (value: string) => void; actions?: React.ReactNode;
}) {
  const vacancyOnly = filters.scope === "vacancy";
  const chosen = participations.find(entry => entry.participation_id === filters.participationId);
  const countOf = (scope: ScopeFilter) => scope === "all" ? counts.all : scope === "vacancy" ? counts.vacancy : counts.candidates;
  return <div className="flex flex-col gap-3">
    <div className="flex flex-wrap items-end gap-3">
      <ToggleGroup variant="segmented" aria-label="Filtrar por ámbito" className="h-11 max-sm:w-full" value={[filters.scope]} onValueChange={next => { if (next[0]) onScope(next[0] as ScopeFilter); }}>
        {SCOPES.map(([scope, label]) => <ToggleGroupItem key={scope} value={scope} className="min-h-10 gap-2 max-sm:min-w-0 max-sm:flex-1 max-sm:gap-1.5 max-sm:px-1.5!">{label}{countOf(scope) !== null && <Badge variant="neutral" className="tabular-nums">{countOf(scope)}</Badge>}</ToggleGroupItem>)}
      </ToggleGroup>
      <div className="flex min-w-0 flex-col gap-1 max-sm:w-full">
        <Label htmlFor="documents-candidate" className="text-xs text-muted-foreground">Candidato</Label>
        <CandidatePicker id="documents-candidate" label="Candidato" participations={participations} value={filters.participationId} onChange={onCandidate}
          disabled={vacancyOnly} placeholder={vacancyOnly ? "No aplica a la vacante" : "Todas las personas"} />
      </div>
      <div className="relative min-w-48 flex-1 max-sm:basis-full sm:max-w-72">
        <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input type="search" aria-label="Buscar documento" placeholder="Buscar documento" className="h-11 pl-9" value={filters.search} onChange={event => onSearch(event.target.value)} />
      </div>
      {actions && <div className="ml-auto flex flex-wrap gap-2 max-sm:w-full">{actions}</div>}
    </div>
    {chosen && <div role="group" aria-label="Filtro activo" className="flex flex-wrap items-center gap-2 text-sm">
      <span className="text-muted-foreground">Filtrando por</span>
      <span className="inline-flex min-h-10 flex-wrap items-center gap-2 rounded-2xl bg-muted px-3 py-1">
        <span aria-hidden="true" className="flex size-6 items-center justify-center rounded-full bg-secondary text-xs font-medium">{initials(chosen.candidate.full_name)}</span>
        <span className="font-medium">{chosen.candidate.full_name}</span><span className="text-muted-foreground">· {chosen.stage.name}</span>
        {chosen.discarded && <Badge variant="neutral">Descartado</Badge>}
        <Button type="button" variant="ghost" className="min-h-10" onClick={() => onCandidate(null)}><X aria-hidden="true" />Quitar filtro</Button>
      </span>
    </div>}
  </div>;
}
