"use client";
import { useEffect, useState, type ReactNode } from "react";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DatePickerField } from "@/components/ui/date-picker-field";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import type { FilterControl } from "./failure";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { personName, requesterLabel, type Person } from "./model";
import { defaultPeriod, matchingShortcut, periodDays, periodIssues, shortcutPeriod, SHORTCUTS, type Period, type Shortcut } from "./period";
import { effectivePeriod, NO_REQUESTER, type MetricsFilters } from "./url-state";

type Option = { value: string; label: string };
const ANY = "__any";
const CUSTOM = "custom";
/** `id` null is that kind «sin especificar», sent as `requester_id=none` with the kind (M6). */
export type RequesterOption = { kind: "client" | "internal_area"; id: string | null; name: string | null };
export type RecruiterOption = Pick<Person, "user_id" | "name" | "former_member">;

function PickFilter({ id, label, items, value, onChange, error, children }: { id: string; label: string; items: Option[]; value: string; onChange: (value: string) => void; error?: string; children: ReactNode }) {
  return <Field data-invalid={error ? true : undefined}>
    <FieldLabel htmlFor={id}>{label}</FieldLabel>
    <Select items={items} value={value} onValueChange={next => { if (next) onChange(next); }}>
      <SelectTrigger id={id} className="min-h-10 w-full" aria-invalid={error ? true : undefined} aria-describedby={error ? `${id}-error` : undefined}><SelectValue>{items.find(option => option.value === value)?.label ?? items[0].label}</SelectValue></SelectTrigger>
      <SelectContent>{children}</SelectContent>
    </Select>
    {error && <FieldError id={`${id}-error`}>{error}</FieldError>}
  </Field>;
}
const plainItems = (options: Option[]) => options.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>);
const recruiterLabel = (person: RecruiterOption) => `${personName(person)}${person.former_member ? " (Ex miembro)" : ""}`;

/**
 * Period and filters of artboard 01's toolbar. The dates are a draft: a valid period goes to the URL at once, an
 * invalid one stays here with its field error and the metrics keep the last valid period.
 */
export function MetricsFiltersBar({ filters, today, recruiters, requesters, showRecruiter = true, serverErrors = {}, onChange }: {
  filters: MetricsFilters; today: string; recruiters?: RecruiterOption[]; requesters?: RequesterOption[]; showRecruiter?: boolean;
  /** 422 `invalid_filter` fields, each shown at its own control (§3.7.10). */
  serverErrors?: Partial<Record<FilterControl, string>>;
  onChange: (next: MetricsFilters) => void;
}) {
  const urlPeriod = { from: filters.from ?? "", to: filters.to ?? "" };
  const [draft, setDraft] = useState<Period>(() => filters.from || filters.to ? urlPeriod : defaultPeriod(today));
  const urlKey = `${filters.from ?? ""}|${filters.to ?? ""}`;
  // Back, forward and «Restablecer» change the URL: the draft follows it.
  useEffect(() => { setDraft(filters.from || filters.to ? { from: filters.from ?? "", to: filters.to ?? "" } : defaultPeriod(today)); }, [urlKey, today]); // eslint-disable-line react-hooks/exhaustive-deps
  const issues = periodIssues(draft);
  const issue = (field: "from" | "to") => issues.find(item => item.field === field)?.message ?? serverErrors[field];
  const changePeriod = (next: Period) => {
    setDraft(next);
    if (!periodIssues(next).length) onChange({ ...filters, ...next });
  };
  const shortcut = issues.length ? CUSTOM : matchingShortcut(draft, today) ?? CUSTOM;
  const shortcutChoices: Option[] = [...SHORTCUTS, { value: CUSTOM, label: "Personalizado" }];

  const people = recruiters ?? [];
  const recruiterChoices: Option[] = [{ value: ANY, label: "Todos los reclutadores" },
    ...(filters.recruiter_id && !people.some(person => person.user_id === filters.recruiter_id) ? [{ value: filters.recruiter_id, label: "Reclutador seleccionado" }] : []),
    ...people.map(person => ({ value: person.user_id, label: recruiterLabel(person) }))];
  const catalog = requesters ?? [];
  const requesterValue = filters.requester_kind && filters.requester_id ? `${filters.requester_kind}:${filters.requester_id}`
    : filters.requester_id === NO_REQUESTER ? NO_REQUESTER
    : filters.requester_kind ? `${filters.requester_kind}:*` : ANY;
  const groups = (["client", "internal_area"] as const).map(kind => ({
    kind, label: kind === "client" ? "Clientes" : "Áreas internas",
    options: [{ value: `${kind}:*`, label: kind === "client" ? "Todos los clientes" : "Todas las áreas internas" },
      ...catalog.filter(item => item.kind === kind).map(item => ({ value: `${kind}:${item.id ?? NO_REQUESTER}`, label: requesterLabel(item) }))],
  }));
  const requesterChoices: Option[] = [{ value: ANY, label: "Todos los clientes y áreas" }, ...groups.flatMap(group => group.options),
    ...(requesterValue !== ANY && requesterValue !== NO_REQUESTER && !groups.some(group => group.options.some(option => option.value === requesterValue)) ? [{ value: requesterValue, label: "Solicitante seleccionado" }] : []),
    { value: NO_REQUESTER, label: "Sin solicitante" }];
  const changeRequester = (value: string) => {
    const rest: MetricsFilters = { ...filters, requester_kind: undefined, requester_id: undefined };
    if (value === ANY) return onChange(rest);
    if (value === NO_REQUESTER) return onChange({ ...rest, requester_id: NO_REQUESTER });
    const [kind, id] = value.split(":") as ["client" | "internal_area", string];
    onChange({ ...rest, requester_kind: kind, ...(id === "*" ? {} : { requester_id: id }) });
  };
  const pristine = !filters.recruiter_id && !filters.requester_kind && !filters.requester_id
    && JSON.stringify(effectivePeriod(filters, today)) === JSON.stringify(defaultPeriod(today)) && !issues.length;

  return <Card size="sm" className="min-w-0">
    <CardContent>
      <section aria-label="Periodo y filtros" className="flex min-w-0 flex-col gap-3">
        <FieldGroup className="grid grid-cols-1 items-start gap-4 sm:grid-cols-2 xl:grid-cols-[repeat(5,minmax(0,1fr))_auto] [&>*]:min-w-0">
          <Field data-invalid={issue("from") ? true : undefined}>
            <FieldLabel htmlFor="metrics-from">Desde</FieldLabel>
            <DatePickerField id="metrics-from" allowPast className="w-full" value={draft.from} error={issue("from")} onChange={from => changePeriod({ ...draft, from })} />
          </Field>
          <Field data-invalid={issue("to") ? true : undefined}>
            <FieldLabel htmlFor="metrics-to">Hasta</FieldLabel>
            <DatePickerField id="metrics-to" allowPast className="w-full" value={draft.to} error={issue("to")} onChange={to => changePeriod({ ...draft, to })} />
          </Field>
          <PickFilter id="metrics-shortcut" label="Atajo" items={shortcutChoices} value={shortcut} onChange={value => { if (value !== CUSTOM) changePeriod(shortcutPeriod(value as Shortcut, today)); }}>
            <SelectGroup>{plainItems(shortcutChoices)}</SelectGroup>
          </PickFilter>
          {showRecruiter && <PickFilter id="metrics-recruiter" label="Reclutador" error={serverErrors.recruiter} items={recruiterChoices} value={filters.recruiter_id ?? ANY} onChange={value => onChange({ ...filters, recruiter_id: value === ANY ? undefined : value })}>
            <SelectGroup>{plainItems(recruiterChoices)}</SelectGroup>
          </PickFilter>}
          {showRecruiter && <PickFilter id="metrics-requester" label="Cliente o área" error={serverErrors.requester} items={requesterChoices} value={requesterValue} onChange={changeRequester}>
            <SelectGroup><SelectItem value={ANY}>Todos los clientes y áreas</SelectItem></SelectGroup>
            {groups.map(group => <SelectGroup key={group.kind}><SelectLabel>{group.label}</SelectLabel>{plainItems(group.options)}</SelectGroup>)}
            <SelectGroup>{plainItems(requesterChoices.filter(option => option.value === NO_REQUESTER || option.label === "Solicitante seleccionado"))}</SelectGroup>
          </PickFilter>}
          <div className="flex items-end self-stretch">
            <Button type="button" variant="ghost" className="min-h-10" disabled={pristine} onClick={() => onChange({})}><RotateCcw aria-hidden="true" data-icon="inline-start" />Restablecer</Button>
          </div>
        </FieldGroup>
        <p className="text-xs text-muted-foreground">{issues.length
          ? "Las métricas siguen mostrando el último periodo válido hasta que lo corrijas."
          : `${periodDays(draft)} días, ambos incluidos · máximo 366 · hora del centro de México. La URL guarda la vista para compartirla.`}</p>
      </section>
    </CardContent>
  </Card>;
}
