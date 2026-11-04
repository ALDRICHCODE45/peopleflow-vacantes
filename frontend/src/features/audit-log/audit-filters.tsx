"use client";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { categoryLabel, eventLabel, isKnownEventType, KNOWN_EVENT_TYPES, type AuditOptions, type AuditType } from "./model";
import type { AuditFilters } from "./url-state";

const SELECT = "h-10 w-full min-w-0 rounded-2xl border border-transparent bg-input/50 px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50";
const MANY = "__many";

/** Types keep the API's order; categories group them. An unknown type shows its code next to the generic label. */
function actionGroups(types: readonly AuditType[], selected: readonly string[]) {
  const all = [...types, ...selected.filter(type => !types.some(item => item.event_type === type)).map(type => ({ event_type: type, category: "other" }))];
  const groups = new Map<string, AuditType[]>();
  for (const type of all) groups.set(type.category, [...(groups.get(type.category) ?? []), type]);
  return [...groups];
}
const actionName = (type: string) => isKnownEventType(type) ? eventLabel(type) : `${eventLabel(type)} (${type})`;

export function AuditFiltersBar({ filters, options, optionsFailed, onRetryOptions, onChange, onClear }: {
  filters: AuditFilters;
  options: AuditOptions | null;
  optionsFailed: boolean;
  onRetryOptions: () => void;
  onChange: (patch: AuditFilters) => void;
  onClear: () => void;
}) {
  const selectedTypes = filters.event_type ?? [];
  const actors = options?.actors ?? [];
  const vacancies = options?.vacancies ?? [];
  const filtered = Object.keys(filters).length > 0;
  return <div className="flex flex-col gap-3">
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
      <Field>
        <FieldLabel htmlFor="audit-actor">Persona</FieldLabel>
        <select id="audit-actor" className={SELECT} value={filters.actor_id ?? ""} onChange={event => onChange({ actor_id: event.target.value || undefined })}>
          <option value="">Todas las personas</option>
          {filters.actor_id && !actors.some(actor => actor.user_id === filters.actor_id) && <option value={filters.actor_id}>Persona seleccionada</option>}
          {actors.map(actor => <option key={actor.user_id} value={actor.user_id}>{`${actor.name ?? actor.email ?? "Usuario eliminado"}${actor.is_current_member ? "" : " (ex miembro)"}`}</option>)}
        </select>
      </Field>
      <Field>
        <FieldLabel htmlFor="audit-action">Acción</FieldLabel>
        <select id="audit-action" className={SELECT} value={selectedTypes.length > 1 ? MANY : selectedTypes[0] ?? ""} onChange={event => onChange({ event_type: event.target.value && event.target.value !== MANY ? [event.target.value] : undefined })}>
          <option value="">Todas las acciones</option>
          {selectedTypes.length > 1 && <option value={MANY}>{`Varias acciones (${selectedTypes.length})`}</option>}
          {actionGroups(options?.types ?? KNOWN_EVENT_TYPES, selectedTypes).map(([category, types]) => <optgroup key={category} label={categoryLabel(category)}>
            {types.map(type => <option key={type.event_type} value={type.event_type}>{actionName(type.event_type)}</option>)}
          </optgroup>)}
        </select>
      </Field>
      <Field>
        <FieldLabel htmlFor="audit-vacancy">Vacante</FieldLabel>
        <select id="audit-vacancy" className={SELECT} value={filters.vacancy_id ?? ""} onChange={event => onChange({ vacancy_id: event.target.value || undefined })}>
          <option value="">Todas las vacantes</option>
          {filters.vacancy_id && !vacancies.some(vacancy => vacancy.vacancy_id === filters.vacancy_id) && <option value={filters.vacancy_id}>Vacante seleccionada</option>}
          {vacancies.map(vacancy => <option key={vacancy.vacancy_id} value={vacancy.vacancy_id}>{vacancy.title ?? "Vacante eliminada"}</option>)}
        </select>
      </Field>
      <Field>
        <FieldLabel htmlFor="audit-from">Desde</FieldLabel>
        <Input id="audit-from" type="date" className="h-10" value={filters.from ?? ""} max={filters.to} onChange={event => onChange({ from: event.target.value || undefined })} />
      </Field>
      <Field>
        <FieldLabel htmlFor="audit-to">Hasta</FieldLabel>
        <Input id="audit-to" type="date" className="h-10" value={filters.to ?? ""} min={filters.from} onChange={event => onChange({ to: event.target.value || undefined })} />
      </Field>
    </div>
    <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
      <span>Las fechas se cuentan en hora de la Ciudad de México.</span>
      {optionsFailed && <>
        <span>No pudimos cargar las opciones de persona y vacante.</span>
        <Button type="button" variant="link" className="min-h-10" onClick={onRetryOptions}>Reintentar opciones</Button>
      </>}
      {filtered && <Button type="button" variant="outline" className="min-h-10" onClick={onClear}>Limpiar filtros</Button>}
    </div>
  </div>;
}
