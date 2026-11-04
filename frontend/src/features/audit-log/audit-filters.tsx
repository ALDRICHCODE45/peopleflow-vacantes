"use client";
import { useState, type ReactNode } from "react";
import { SlidersHorizontal, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DatePickerField } from "@/components/ui/date-picker-field";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { categoryLabel, eventLabel, isKnownEventType, KNOWN_EVENT_TYPES, type AuditOptions, type AuditType } from "./model";
import type { AuditFilters } from "./url-state";

type Option = { value: string; label: string };
const ANY = "__any";
const MANY = "__many";

/** Types keep the API's order; categories group them. An unknown type shows its code next to the generic label. */
function actionGroups(types: readonly AuditType[], selected: readonly string[]) {
  const all = [...types, ...selected.filter(type => !types.some(item => item.event_type === type)).map(type => ({ event_type: type, category: "other" }))];
  const groups = new Map<string, AuditType[]>();
  for (const type of all) groups.set(type.category, [...(groups.get(type.category) ?? []), type]);
  return [...groups];
}
const actionName = (type: string) => isKnownEventType(type) ? eventLabel(type) : `${eventLabel(type)} (${type})`;
const dayName = (value: string) => {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString("es", { day: "numeric", month: "long", year: "numeric" });
};

/** Same Select recipe as the talent base's SingleFilter; grouped choices render inside `children`. */
function PickFilter({ id, label, items, value, onChange, children }: { id: string; label: string; items: Option[]; value: string; onChange: (value: string) => void; children: ReactNode }) {
  return <Field>
    <FieldLabel htmlFor={id}>{label}</FieldLabel>
    <Select items={items} value={value} onValueChange={next => { if (next) onChange(next); }}>
      <SelectTrigger id={id} className="min-h-10 w-full"><SelectValue>{items.find(option => option.value === value)?.label ?? items[0].label}</SelectValue></SelectTrigger>
      <SelectContent>{children}</SelectContent>
    </Select>
  </Field>;
}
const plainItems = (options: Option[]) => options.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>);

type Chip = { key: string; label: string; remove: AuditFilters };

export function AuditFiltersBar({ filters, options, optionsFailed, onRetryOptions, onChange, onClear, actions }: {
  filters: AuditFilters;
  options: AuditOptions | null;
  optionsFailed: boolean;
  onRetryOptions: () => void;
  onChange: (patch: AuditFilters) => void;
  onClear: () => void;
  /** Toolbar actions (column controls, export) sit on the right, like the talent base's view toggle. */
  actions?: ReactNode;
}) {
  // A shared link with filters opens the panel so the active conditions are never hidden.
  const [open, setOpen] = useState(() => Object.keys(filters).length > 0);
  const selectedTypes = filters.event_type ?? [];
  const actors = options?.actors ?? [];
  const vacancies = options?.vacancies ?? [];
  const actorName = (actor: (typeof actors)[number]) => `${actor.name ?? actor.email ?? "Usuario eliminado"}${actor.is_current_member ? "" : " (ex miembro)"}`;
  const actorChoices: Option[] = [{ value: ANY, label: "Todas las personas" },
    ...(filters.actor_id && !actors.some(actor => actor.user_id === filters.actor_id) ? [{ value: filters.actor_id, label: "Persona seleccionada" }] : []),
    ...actors.map(actor => ({ value: actor.user_id, label: actorName(actor) }))];
  const vacancyChoices: Option[] = [{ value: ANY, label: "Todas las vacantes" },
    ...(filters.vacancy_id && !vacancies.some(vacancy => vacancy.vacancy_id === filters.vacancy_id) ? [{ value: filters.vacancy_id, label: "Vacante seleccionada" }] : []),
    ...vacancies.map(vacancy => ({ value: vacancy.vacancy_id, label: vacancy.title ?? "Vacante eliminada" }))];
  const groups = actionGroups(options?.types ?? KNOWN_EVENT_TYPES, selectedTypes);
  const actionChoices: Option[] = [{ value: ANY, label: "Todas las acciones" },
    ...(selectedTypes.length > 1 ? [{ value: MANY, label: `Varias acciones (${selectedTypes.length})` }] : []),
    ...groups.flatMap(([, types]) => types.map(type => ({ value: type.event_type, label: actionName(type.event_type) })))];

  const chips: Chip[] = [
    ...(filters.actor_id ? [{ key: "actor_id", label: `Persona: ${actorChoices.find(choice => choice.value === filters.actor_id)?.label}`, remove: { actor_id: undefined } }] : []),
    ...selectedTypes.map(type => ({ key: `event_type:${type}`, label: `Acción: ${actionName(type)}`, remove: { event_type: selectedTypes.filter(value => value !== type) } })),
    ...(filters.vacancy_id ? [{ key: "vacancy_id", label: `Vacante: ${vacancyChoices.find(choice => choice.value === filters.vacancy_id)?.label}`, remove: { vacancy_id: undefined } }] : []),
    ...(filters.from ? [{ key: "from", label: `Desde: ${dayName(filters.from)}`, remove: { from: undefined } }] : []),
    ...(filters.to ? [{ key: "to", label: `Hasta: ${dayName(filters.to)}`, remove: { to: undefined } }] : []),
  ];

  return <section aria-label="Filtros de la auditoría" className="flex min-w-0 flex-col gap-3">
    <div data-audit-toolbar className="flex min-w-0 flex-wrap items-start justify-between gap-3">
      <Button type="button" variant="outline" className="min-h-10" aria-expanded={open} aria-controls="audit-filters" onClick={() => setOpen(value => !value)}><SlidersHorizontal aria-hidden="true" data-icon="inline-start" />Filtros{chips.length > 0 && <Badge variant="secondary">{chips.length}</Badge>}</Button>
      {actions && <div className="flex min-w-0 flex-wrap items-start gap-2">{actions}</div>}
    </div>
    {open && <div id="audit-filters" role="region" aria-label="Filtrar actividad" className="rounded-lg bg-background p-4 md:p-5">
      <FieldGroup className="grid grid-cols-1 items-start gap-4 sm:grid-cols-2 xl:grid-cols-5 [&>*]:min-w-0">
        <PickFilter id="audit-actor" label="Persona" items={actorChoices} value={filters.actor_id ?? ANY} onChange={value => onChange({ actor_id: value === ANY ? undefined : value })}>
          <SelectGroup>{plainItems(actorChoices)}</SelectGroup>
        </PickFilter>
        <PickFilter id="audit-action" label="Acción" items={actionChoices} value={selectedTypes.length > 1 ? MANY : selectedTypes[0] ?? ANY} onChange={value => { if (value !== MANY) onChange({ event_type: value === ANY ? undefined : [value] }); }}>
          <SelectGroup><SelectItem value={ANY}>Todas las acciones</SelectItem>{selectedTypes.length > 1 && <SelectItem value={MANY}>{`Varias acciones (${selectedTypes.length})`}</SelectItem>}</SelectGroup>
          {groups.map(([category, types]) => <SelectGroup key={category}>
            <SelectLabel>{categoryLabel(category)}</SelectLabel>
            {types.map(type => <SelectItem key={type.event_type} value={type.event_type}>{actionName(type.event_type)}</SelectItem>)}
          </SelectGroup>)}
        </PickFilter>
        <PickFilter id="audit-vacancy" label="Vacante" items={vacancyChoices} value={filters.vacancy_id ?? ANY} onChange={value => onChange({ vacancy_id: value === ANY ? undefined : value })}>
          <SelectGroup>{plainItems(vacancyChoices)}</SelectGroup>
        </PickFilter>
        <Field>
          <FieldLabel htmlFor="audit-from">Desde</FieldLabel>
          <DatePickerField id="audit-from" allowPast className="w-full" value={filters.from ?? ""} onChange={from => onChange({ from })} />
        </Field>
        <Field>
          <FieldLabel htmlFor="audit-to">Hasta</FieldLabel>
          <DatePickerField id="audit-to" allowPast className="w-full" value={filters.to ?? ""} onChange={to => onChange({ to })} />
        </Field>
      </FieldGroup>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex max-w-prose flex-col gap-1 text-xs text-muted-foreground">
          <p>Las fechas se cuentan en hora de la Ciudad de México.</p>
          {optionsFailed && <p className="flex flex-wrap items-center gap-1">No pudimos cargar las opciones de persona y vacante.<Button type="button" variant="link" className="min-h-10" onClick={onRetryOptions}>Reintentar opciones</Button></p>}
        </div>
        <Button type="button" variant="ghost" className="min-h-10" onClick={onClear}>Limpiar filtros</Button>
      </div>
    </div>}
    {!!chips.length && <div className="flex min-w-0 flex-wrap items-center gap-2">
      {chips.map(chip => <Button key={chip.key} type="button" variant="outline" className="h-auto min-h-10 max-w-full whitespace-normal" aria-label={`Quitar filtro ${chip.label}`} onClick={() => onChange(chip.remove)}>{chip.label}<X aria-hidden="true" data-icon="inline-end" /></Button>)}
      <Button type="button" variant="ghost" className="min-h-10" onClick={onClear}>Limpiar</Button>
    </div>}
  </section>;
}
