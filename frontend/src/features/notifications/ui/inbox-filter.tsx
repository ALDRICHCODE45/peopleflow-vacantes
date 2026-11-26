"use client";
import { useEffect, useId, useRef, useState, type ReactNode, type RefObject } from "react";
import { Search, SlidersHorizontal } from "lucide-react";
import { cn } from "cn";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { getFacetsAction } from "../actions";
import {
  activeFiltersLabel, FILTER_GROUPS, filterGroupCount, jobsShownNote, jobTitle, MAX_FILTER_JOBS, showResultsLabel,
  type FilterGroupKey, type FilterJob,
} from "../copy";
import type { NotificationFacets, NotificationState } from "../model";

export type InboxFilterValue = { groups: FilterGroupKey[]; jobs: FilterJob[] };
type Facets = { state: NotificationState; data: NotificationFacets | null };

const normalize = (text: string) => text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

async function readFacets(state: NotificationState): Promise<NotificationFacets | null> {
  try {
    const result = await getFacetsAction(state);
    return result.ok ? result.data : null;
  } catch { return null; }
}

type Props = {
  tab: NotificationState;
  value: InboxFilterValue;
  onChange: (value: InboxFilterValue) => void;
  /** Groups behind the popover when the whole list is loaded; `null` when unknown. */
  results: number | null;
  triggerRef: RefObject<HTMLButtonElement | null>;
};

/**
 * «Filtrar» of design 07: an outline button with the active-filter count that opens a small non-modal popover with
 * Tipo and Vacante checkboxes. Counts come from the tab's facets (unread or all); changes apply at once. Vacancies can
 * be searched and are capped at the backend's 20 `job_ids`.
 */
export function InboxFilter({ tab, value, onChange, results, triggerRef }: Props) {
  const [open, setOpen] = useState(false);
  const [facets, setFacets] = useState<Facets | null>(null);
  const [query, setQuery] = useState("");
  const firstBox = useRef<HTMLButtonElement>(null);
  const active = value.groups.length + value.jobs.length;

  useEffect(() => {
    if (!open) return;
    let current = true;
    void readFacets(tab).then(data => { if (current) setFacets({ state: tab, data }); });
    return () => { current = false; };
  }, [open, tab]);

  const data = facets?.state === tab ? facets.data : null;
  const loading = facets?.state !== tab;
  const toggleGroup = (key: FilterGroupKey, on: boolean) =>
    onChange({ ...value, groups: on ? FILTER_GROUPS.map(g => g.key).filter(k => k === key || value.groups.includes(k)) : value.groups.filter(k => k !== key) });
  const toggleJob = (job: FilterJob, on: boolean) =>
    onChange({ ...value, jobs: on ? [...value.jobs, job] : value.jobs.filter(j => j.id !== job.id) });

  return <Popover open={open} onOpenChange={next => { setOpen(next); if (next) setQuery(""); }}>
    <PopoverTrigger render={<Button ref={triggerRef} type="button" variant="outline" aria-label={active > 0 ? `Filtrar${activeFiltersLabel(active)}` : undefined}
      className={cn("ml-auto min-h-9 gap-2 px-3", active > 0 && "border-primary/60 bg-primary/8")} />}>
      <SlidersHorizontal aria-hidden="true" />Filtrar
      {active > 0 && <span aria-hidden="true" className="grid h-5 min-w-5 place-items-center rounded-full bg-primary px-1.5 text-xs font-semibold text-primary-foreground tabular-nums">{active}</span>}
    </PopoverTrigger>
    <PopoverContent align="end" initialFocus={firstBox} className="max-h-[min(560px,var(--available-height))] w-[min(340px,calc(100vw-24px))] gap-0 overflow-hidden p-0">
      <div className="px-4 pt-3.5 pb-1.5"><PopoverTitle className="text-sm font-semibold">Filtrar notificaciones</PopoverTitle></div>
      <div className="grid min-h-0 gap-3.5 overflow-y-auto px-4 pt-1 pb-3">
        <Group legend="Tipo">
          <Choice label="Todos" count={data ? data.types.reduce((sum, t) => sum + t.count, 0) : null} checked={value.groups.length === 0}
            onChange={on => { if (on) onChange({ ...value, groups: [] }); }} boxRef={firstBox} />
          {FILTER_GROUPS.map(group => <Choice key={group.key} label={group.label} count={data ? filterGroupCount(data.types, group.key) : null}
            checked={value.groups.includes(group.key)} onChange={on => toggleGroup(group.key, on)} />)}
        </Group>
        <JobChoices data={data} loading={loading} selected={value.jobs} query={query} onQuery={setQuery} onToggle={toggleJob} />
      </div>
      <div className="flex items-center justify-between gap-2 border-t border-border/60 px-3 pt-2.5 pb-3">
        <Button type="button" variant="ghost" disabled={active === 0} onClick={() => onChange({ groups: [], jobs: [] })}>Limpiar</Button>
        <Button type="button" onClick={() => setOpen(false)}>{showResultsLabel(results)}</Button>
      </div>
    </PopoverContent>
  </Popover>;
}

function JobChoices({ data, loading, selected, query, onQuery, onToggle }: {
  data: NotificationFacets | null; loading: boolean; selected: FilterJob[]; query: string;
  onQuery: (query: string) => void; onToggle: (job: FilterJob, on: boolean) => void;
}) {
  const known = data?.jobs ?? [];
  // Picked vacancies the facets no longer list (other tab) stay visible so they can be unchecked.
  const extra = selected.filter(job => !known.some(k => k.job_id === job.id)).map(job => ({ job_id: job.id, title: job.title, count: 0 }));
  const all = [...known, ...extra];
  const term = normalize(query.trim());
  const shown = term ? all.filter(job => normalize(jobTitle(job.title)).includes(term)) : all;
  const full = selected.length >= MAX_FILTER_JOBS;
  const isOn = (id: string) => selected.some(job => job.id === id);

  return <Group legend="Vacante">
    <InputGroup className="mb-1">
      <InputGroupAddon><Search aria-hidden="true" /></InputGroupAddon>
      <InputGroupInput type="search" aria-label="Buscar vacante" placeholder="Buscar vacante" autoComplete="off" value={query} onChange={event => onQuery(event.target.value)} />
    </InputGroup>
    {loading ? <p className="px-1 text-sm text-muted-foreground">Cargando vacantes…</p>
      : data === null ? <p className="px-1 text-sm text-muted-foreground">No pudimos cargar las vacantes.</p>
      : shown.length === 0 ? <p role="status" className="rounded-xl bg-muted px-3 py-2.5 text-[13px] text-muted-foreground">{term ? `Ninguna vacante coincide con «${query.trim()}».` : "Sin vacantes con notificaciones."}</p>
      : <div className="grid">{shown.map(job => <Choice key={job.job_id} label={jobTitle(job.title)} count={job.count}
          checked={isOn(job.job_id)} disabled={full && !isOn(job.job_id)} onChange={on => onToggle({ id: job.job_id, title: job.title }, on)} />)}</div>}
    {full && <p className="px-1 text-xs text-muted-foreground">Puedes elegir hasta {MAX_FILTER_JOBS} vacantes.</p>}
    {data && data.jobs_total > data.jobs.length && <p className="px-1 text-xs text-muted-foreground">{jobsShownNote(data.jobs.length, data.jobs_total)}</p>}
  </Group>;
}

function Group({ legend, children }: { legend: string; children: ReactNode }) {
  return <fieldset className="m-0 grid min-w-0 gap-0.5 border-0 p-0">
    <legend className="mb-1.5 p-0 text-xs font-semibold text-muted-foreground">{legend}</legend>
    {children}
  </fieldset>;
}

function Choice({ label, count, checked, disabled, onChange, boxRef }: {
  label: string; count: number | null; checked: boolean; disabled?: boolean; onChange: (on: boolean) => void;
  boxRef?: RefObject<HTMLButtonElement | null>;
}) {
  const id = useId();
  return <label className={cn("flex min-h-10 items-center gap-3 rounded-xl px-2 text-sm", disabled ? "cursor-not-allowed text-muted-foreground" : "cursor-pointer hover:bg-muted/70")}>
    <Checkbox ref={boxRef} checked={checked} disabled={disabled} aria-labelledby={`${id}-l ${id}-c`} onCheckedChange={next => onChange(next)} />
    <span id={`${id}-l`} className="min-w-0 flex-1 break-words">{label}</span>
    <span id={`${id}-c`} className="text-xs text-muted-foreground tabular-nums">{count ?? ""}</span>
  </label>;
}
