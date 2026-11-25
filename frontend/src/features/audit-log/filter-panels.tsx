"use client";
import { useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Briefcase, Search, Users } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChoiceList, type ChoiceOption } from "@/components/ui/choice-list";
import { Field, FieldLabel } from "@/components/ui/field";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { initials } from "@/features/pipeline-movement/pipeline-presentation";
import { accentAvatar } from "@/lib/accent";
import { cn } from "@/lib/utils";
import { AuditDateField } from "./audit-date-field";
import { actionGroups, actionName, actorName, searchKey, vacancyTag } from "./filter-model";
import { categoryLabel, KNOWN_EVENT_TYPES, RANGE_MESSAGE, vacancyTitleLabel, type AuditActor, type AuditOptions, type AuditVacancy } from "./model";
import type { DayRange } from "./date-range";

const ANY = "__any";
/** The panels' lists scroll inside the popover so the search and the footer stay in view. */
const SCROLL = "max-h-[min(24rem,50dvh)] overflow-y-auto overscroll-contain rounded-2xl [scrollbar-width:thin]";

function SearchBox({ label, placeholder, value, onChange, onKeyDown }: { label: string; placeholder: string; value: string; onChange: (value: string) => void; onKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void }) {
  return <InputGroup className="min-h-10">
    <InputGroupInput type="search" aria-label={label} placeholder={placeholder} value={value} autoComplete="off" onChange={event => onChange(event.target.value)} onKeyDown={onKeyDown} />
    <InputGroupAddon><Search aria-hidden="true" /></InputGroupAddon>
  </InputGroup>;
}
const NoMatches = ({ query }: { query: string }) => <p className="px-4 py-5 text-center text-sm text-muted-foreground">{`Sin coincidencias para «${query.trim()}».`}</p>;

/** An initials circle like the artboard's person rows (decorative: the row is named by the person). */
const InitialsAvatar = ({ name }: { name: string }) => <Avatar><AvatarFallback className={cn("text-xs font-medium", accentAvatar)}>{initials(name)}</AvatarFallback></Avatar>;

/**
 * Single choice (person, vacancy): a click commits and closes, but the arrow keys only move the selection (a radio group selects as it
 * moves, so committing there would close the panel on the first key). Enter on a row or «Aplicar» commits what is selected.
 * From the search, ArrowDown moves into the list (onto the chosen row, else the first) and Enter commits the first match.
 */
function SingleChoicePanel({ query, onQuery, searchLabel, placeholder, legend, options, selectedId, onPick, note, empty }: {
  query: string; onQuery: (value: string) => void; searchLabel: string; placeholder: string;
  legend: string; options: ChoiceOption[]; selectedId?: string; onPick: (value: string | undefined) => void; note: string; empty: ReactNode;
}) {
  const [draft, setDraft] = useState(selectedId ?? ANY);
  // What the person last used decides what a change of the radio group means: pointer = pick, keyboard = move.
  const input = useRef<"pointer" | "key">("pointer");
  const list = useRef<HTMLDivElement>(null);
  const apply = (value: string) => onPick(value === ANY ? undefined : value);
  function onSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "ArrowDown") {
      const index = Math.max(0, options.findIndex(option => option.value === draft));
      const target = options[index];
      const radios = list.current?.querySelectorAll<HTMLElement>("[role=radio]");
      if (!target || !radios?.[index]) return;
      event.preventDefault();
      // Moving into a radio group selects what it lands on, like the arrow keys do inside it.
      input.current = "key";
      setDraft(target.value);
      radios[index].focus();
    } else if (event.key === "Enter") {
      event.preventDefault();
      // With a search the first match is the answer; with none, Enter applies what is already chosen.
      if (query.trim()) { if (options[0]) apply(options[0].value); } else apply(draft);
    }
  }
  return <div className="flex flex-col gap-3">
    <SearchBox label={searchLabel} placeholder={placeholder} value={query} onChange={onQuery} onKeyDown={onSearchKeyDown} />
    {options.length
      ? <div ref={list} className={SCROLL} onKeyDownCapture={() => { input.current = "key"; }} onPointerDownCapture={() => { input.current = "pointer"; }}
        onKeyDown={event => { if (event.key === "Enter" && (event.target as HTMLElement).closest("[role=radio]")) { event.preventDefault(); apply(draft); } }}>
        <ChoiceList legend={legend} hideLegend value={draft} options={options} onValueChange={next => { setDraft(next); if (input.current === "pointer") apply(next); }} />
      </div>
      : empty}
    <div className="flex items-center justify-between gap-3">
      <p className="min-w-0 text-xs text-muted-foreground">{note}</p>
      <Button type="button" className="min-h-10 shrink-0" onClick={() => apply(draft)}>Aplicar</Button>
    </div>
  </div>;
}

export function PersonPanel({ actors, selectedId, onPick }: { actors: AuditActor[]; selectedId?: string; onPick: (id: string | undefined) => void }) {
  const [query, setQuery] = useState("");
  const q = searchKey(query);
  const shown = actors.filter(actor => !q || searchKey(`${actorName(actor)} ${actor.email ?? ""}`).includes(q));
  const orphan = selectedId && !actors.some(actor => actor.user_id === selectedId);
  const options: ChoiceOption[] = [
    ...(q ? [] : [{ value: ANY, title: "Todas las personas", leading: <Avatar><AvatarFallback className="bg-muted text-muted-foreground"><Users aria-hidden="true" className="size-4" /></AvatarFallback></Avatar> }]),
    ...(orphan && !q ? [{ value: selectedId, title: "Persona seleccionada" }] : []),
    ...shown.map(actor => ({ value: actor.user_id, title: actorName(actor), description: actor.email && actor.email !== actorName(actor) ? actor.email : undefined,
      leading: <InitialsAvatar name={actorName(actor)} />,
      meta: actor.is_current_member ? undefined : <Badge variant="neutral">Ex miembro</Badge> })),
  ];
  return <SingleChoicePanel query={query} onQuery={setQuery} searchLabel="Buscar persona" placeholder="Buscar por nombre o correo" legend="Personas"
    options={options} selectedId={selectedId} onPick={onPick} empty={<NoMatches query={query} />} note={`${shown.length} de ${actors.length} personas · incluye a quienes ya no son miembros`} />;
}

export function VacancyPanel({ vacancies, selectedId, onPick }: { vacancies: AuditVacancy[]; selectedId?: string; onPick: (id: string | undefined) => void }) {
  const [query, setQuery] = useState("");
  const q = searchKey(query);
  const shown = vacancies.filter(vacancy => !q || searchKey(vacancyTitleLabel(vacancy.title).label).includes(q));
  const orphan = selectedId && !vacancies.some(vacancy => vacancy.vacancy_id === selectedId);
  const options: ChoiceOption[] = [
    ...(q ? [] : [{ value: ANY, title: "Todas las vacantes", leading: <Briefcase /> }]),
    ...(orphan && !q ? [{ value: selectedId, title: "Vacante seleccionada" }] : []),
    ...shown.map(vacancy => {
      const { label, missing } = vacancyTitleLabel(vacancy.title);
      return { value: vacancy.vacancy_id, title: missing ? <span className="font-normal text-muted-foreground">{label}</span> : label,
        description: missing ? `Identificador #${vacancyTag(vacancy.vacancy_id)}` : undefined };
    }),
  ];
  return <SingleChoicePanel query={query} onQuery={setQuery} searchLabel="Buscar vacante" placeholder="Buscar por título de vacante" legend="Vacantes"
    options={options} selectedId={selectedId} onPick={onPick} empty={<NoMatches query={query} />} note={`${shown.length} de ${vacancies.length} vacantes · el título se muestra completo`} />;
}

/**
 * Many actions, grouped by category: each group is a `ChoiceList` under a heading with the count and a compact «Elegir todas» link
 * (artboard `audit-log-redesign/01`), not a full «Seleccionar todo» row. The shared rows are one tab stop each, so this list keeps a
 * roving tab stop instead of 75: one Tab enters it, the arrow keys (and Home / End) move between options across groups, Space toggles.
 */
export function ActionPanel({ types, selected, onChange }: { types: AuditOptions["types"]; selected: string[]; onChange: (next: string[]) => void }) {
  const [query, setQuery] = useState("");
  const list = useRef<HTMLDivElement>(null);
  const tabStop = useRef<HTMLElement | null>(null);
  const rows = () => Array.from(list.current?.querySelectorAll<HTMLElement>("[role=checkbox]") ?? []);
  const setTabStop = (row: HTMLElement | undefined) => {
    const all = rows();
    const current = row ?? (tabStop.current && all.includes(tabStop.current) ? tabStop.current : all[0]);
    tabStop.current = current ?? null;
    for (const item of all) item.tabIndex = item === current ? 0 : -1;
  };
  // Every render (search, toggles) may add or replace rows: keep exactly one of them in the tab order.
  useLayoutEffect(() => { setTabStop(undefined); });
  function onListKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const moves = ["ArrowDown", "ArrowUp", "Home", "End"];
    if (!moves.includes(event.key) || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const row = (event.target as HTMLElement).closest<HTMLElement>("[role=checkbox]");
    const all = rows();
    const index = row ? all.indexOf(row) : -1;
    if (index < 0) return;
    const next = event.key === "ArrowDown" ? index + 1 : event.key === "ArrowUp" ? index - 1 : event.key === "Home" ? 0 : all.length - 1;
    if (!all[next]) return;
    event.preventDefault();
    all[next].focus();
  }
  const q = searchKey(query);
  const catalog = types.length ? types : KNOWN_EVENT_TYPES;
  const groups = actionGroups(catalog, selected).map(([category, all]) => ({ category, all,
    items: all.filter(type => !q || searchKey(actionName(type.event_type)).includes(q) || searchKey(categoryLabel(category)).includes(q)) })).filter(group => group.items.length);
  const total = catalog.length;
  return <div className="flex flex-col gap-3">
    <SearchBox label="Buscar acción" placeholder={`Buscar entre las ${total} acciones`} value={query} onChange={setQuery}
      onKeyDown={event => {
        if (event.key !== "ArrowDown" || event.nativeEvent.isComposing) return;
        const target = tabStop.current ?? rows()[0];
        if (!target) return;
        event.preventDefault();
        target.focus();
      }} />
    <div ref={list} className={`${SCROLL} flex flex-col gap-4`} onKeyDown={onListKeyDown} onFocus={event => { const row = (event.target as HTMLElement).closest<HTMLElement>("[role=checkbox]"); if (row) setTabStop(row); }}>
      {groups.length ? groups.map(({ category, all, items }) => {
        const inGroup = all.map(type => type.event_type);
        const chosen = selected.filter(type => inGroup.includes(type));
        const complete = chosen.length === all.length;
        const name = categoryLabel(category);
        const verb = complete ? "Quitar todas" : "Elegir todas";
        return <div key={category} className="flex flex-col gap-1">
          <div data-audit-group-heading className="flex items-center justify-between gap-2 px-1">
            <span aria-hidden="true" className="text-sm"><b className="font-medium">{name}</b>{" "}<span className="text-muted-foreground tabular-nums">{`${chosen.length} de ${all.length}`}</span></span>
            {all.length >= 2 && <Button type="button" variant="link" className="h-auto min-h-10 px-1 text-[13px]" aria-label={`${verb} las acciones de ${name}`}
              onClick={() => onChange([...selected.filter(type => !inGroup.includes(type)), ...(complete ? [] : inGroup)])}>{verb}</Button>}
          </div>
          <ChoiceList multiple selectAll={false} hideLegend legend={`${name} ${chosen.length} de ${all.length}`}
            options={items.map(type => ({ value: type.event_type, title: actionName(type.event_type) }))}
            value={chosen}
            onValueChange={next => onChange([...selected.filter(type => !inGroup.includes(type)), ...next])} />
        </div>;
      }) : <NoMatches query={query} />}
    </div>
    <div className="flex items-center justify-between gap-2">
      <span role="status" aria-live="polite" className="text-xs text-muted-foreground">{selected.length ? `${selected.length} ${selected.length === 1 ? "acción elegida" : "acciones elegidas"}` : `${total} acciones`}</span>
      {selected.length > 0 && <Button type="button" variant="ghost" className="min-h-10" aria-label="Limpiar acciones" onClick={() => onChange([])}>Limpiar</Button>}
    </div>
  </div>;
}

/** Two audit date fields (short days: a date is never cut off): a range that ends before it starts is held back here and never reaches the URL. */
export function DateInputs({ idPrefix, from, to, onChange }: { idPrefix: string; from: string; to: string; onChange: (next: { from: string; to: string }) => void }) {
  return <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
    <Field><FieldLabel htmlFor={`${idPrefix}-from`}>Desde</FieldLabel><AuditDateField id={`${idPrefix}-from`} value={from} onChange={next => onChange({ from: next, to })} /></Field>
    <Field><FieldLabel htmlFor={`${idPrefix}-to`}>Hasta</FieldLabel><AuditDateField id={`${idPrefix}-to`} value={to} onChange={next => onChange({ from, to: next })} /></Field>
  </div>;
}

/** Desde / Hasta with the order check: shared by the desktop popover and the phone drawer. */
export function RangeFields({ idPrefix, range, onApply }: { idPrefix: string; range: DayRange; onApply: (patch: DayRange) => void }) {
  const [draft, setDraft] = useState({ from: range.from ?? "", to: range.to ?? "" });
  const inverted = !!draft.from && !!draft.to && draft.from > draft.to;
  return <div className="flex flex-col gap-3">
    <DateInputs idPrefix={idPrefix} from={draft.from} to={draft.to} onChange={next => {
      setDraft(next);
      if (!(next.from && next.to && next.from > next.to)) onApply({ from: next.from || undefined, to: next.to || undefined });
    }} />
    {inverted ? <p role="alert" className="text-xs text-status-danger">{RANGE_MESSAGE}</p> : <p className="text-xs text-muted-foreground">Las fechas se cuentan en hora de la Ciudad de México.</p>}
  </div>;
}

export function CustomRangePanel({ range, onApply, onClear, onDone }: { range: DayRange; onApply: (patch: DayRange) => void; onClear: () => void; onDone: () => void }) {
  return <div className="flex flex-col gap-3">
    <h3 className="text-base font-medium">Rango personalizado</h3>
    <RangeFields idPrefix="audit-range" range={range} onApply={onApply} />
    <div className="flex flex-wrap justify-end gap-2">
      <Button type="button" variant="outline" className="min-h-10" onClick={onClear}>Quitar rango</Button>
      <Button type="button" className="min-h-10" onClick={onDone}>Listo</Button>
    </div>
  </div>;
}
