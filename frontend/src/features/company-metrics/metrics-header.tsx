"use client";
import { useEffect, useState } from "react";
import { CalendarRange, ListFilter, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DatePickerField } from "@/components/ui/date-picker-field";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { FilterControl } from "./failure";
import { AudienceFields, audienceChips, type RecruiterOption, type RequesterOption } from "./metrics-filters";
import { dayLabel, momentLabel } from "./model";
import { matchingShortcut, periodIssues, shortcutPeriod, type Period, type Shortcut } from "./period";
import { effectivePeriod, type MetricsFilters } from "./url-state";

/** Rule 11: the period as a segmented control in the header. */
const PERIODS: { value: Shortcut; label: string }[] = [
  { value: "last_30", label: "30 días" }, { value: "last_90", label: "90 días" }, { value: "last_12_months", label: "12 meses" },
];

/**
 * Board header (`design/system.md` rules 2 and 11): title, scope, freshness once, the period control and one «Filtros»
 * popover; active filters show as removable chips under it. Never a form bar above the data.
 */
export function MetricsBoardHeader({ filters, today, asOf, version, appliedPeriod, recruiters, requesters, serverErrors = {}, onChange, onFiltersOpen }: {
  filters: MetricsFilters; today: string;
  /** `as_of` of the summary: when the numbers were computed. */
  asOf?: string; version?: string;
  /** The period the API answered for; until it answers, the one the URL asks for. */
  appliedPeriod?: Period;
  recruiters: RecruiterOption[]; requesters: RequesterOption[];
  serverErrors?: Partial<Record<FilterControl, string>>;
  onChange: (next: MetricsFilters) => void;
  onFiltersOpen?: () => void;
}) {
  const period = effectivePeriod(filters, today);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const shown = appliedPeriod ?? period;
  const shortcut = matchingShortcut(period, today);
  const chips = audienceChips(filters, recruiters, requesters);
  const audienceCount = chips.length;
  const freshness = [asOf && `Actualizado ${momentLabel(asOf)}`, `${dayLabel(shown.from)} – ${dayLabel(shown.to)}`, version && `Definiciones ${version}`].filter(Boolean).join(" · ");

  return <header className="flex flex-col gap-4">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="flex min-w-0 flex-col gap-1">
        <h2 className="font-heading text-2xl font-semibold tracking-tight">Métricas</h2>
        <p className="text-sm text-muted-foreground">Entregas, cierres y desempeño del equipo de tu empresa.</p>
        <p className="text-xs text-muted-foreground">{freshness}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Periodo" className="flex rounded-xl border bg-card p-0.5">
          {PERIODS.map(item => <Button key={item.value} type="button" variant="ghost" aria-pressed={shortcut === item.value}
            className={cn("min-h-10 rounded-lg px-3 text-muted-foreground", shortcut === item.value && "bg-primary/10 font-semibold text-primary hover:bg-primary/15 hover:text-primary")}
            onClick={() => onChange({ ...filters, ...shortcutPeriod(item.value, today) })}>{item.label}</Button>)}
          <CustomPeriod period={period} active={!shortcut} error={serverErrors.from ?? serverErrors.to} onApply={next => onChange({ ...filters, ...next })} />
        </div>
        <Popover open={filtersOpen} onOpenChange={open => { setFiltersOpen(open); if (open) onFiltersOpen?.(); }}>
          <PopoverTrigger render={<Button type="button" variant="outline" className="min-h-10" />}>
            <ListFilter aria-hidden="true" data-icon="inline-start" />{audienceCount ? `Filtros · ${audienceCount}` : "Filtros"}
          </PopoverTrigger>
          <PopoverContent align="end" className="w-80 max-w-[calc(100vw-2rem)]">
            <PopoverTitle className="font-semibold">Filtros</PopoverTitle>
            <div className="flex flex-col gap-4">
              <AudienceFields filters={filters} recruiters={recruiters} requesters={requesters} serverErrors={serverErrors} onChange={onChange} />
            </div>
          </PopoverContent>
        </Popover>
      </div>
    </div>
    {chips.length > 0 && <ul aria-label="Filtros activos" className="flex flex-wrap items-center gap-2">
      {chips.map(chip => <li key={chip.key} className="flex items-center gap-1 rounded-full border bg-card py-1 pr-1 pl-3 text-sm">
        {chip.label}
        <Button type="button" variant="ghost" size="icon" className="size-8 rounded-full" aria-label={`Quitar filtro ${chip.label}`}
          onClick={() => onChange(chip.key === "recruiter" ? { ...filters, recruiter_id: undefined } : { ...filters, requester_kind: undefined, requester_id: undefined })}>
          <X aria-hidden="true" />
        </Button>
      </li>)}
      <li><Button type="button" variant="link" className="min-h-10" onClick={() => onChange({ from: filters.from, to: filters.to })}>Limpiar filtros</Button></li>
    </ul>}
  </header>;
}

/** «Personalizado»: a draft period applied only when valid; the board keeps the last valid period meanwhile. */
function CustomPeriod({ period, active, error, onApply }: { period: Period; active: boolean; error?: string; onApply: (next: Period) => void }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(period);
  useEffect(() => { if (open) setDraft(period); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const issues = periodIssues(draft);
  const issue = (field: "from" | "to") => issues.find(item => item.field === field)?.message;
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger render={<Button type="button" variant="ghost" aria-pressed={active}
      className={cn("min-h-10 rounded-lg px-3 text-muted-foreground", active && "bg-primary/10 font-semibold text-primary hover:bg-primary/15 hover:text-primary")} />}>
      <CalendarRange aria-hidden="true" data-icon="inline-start" />Personalizado
    </PopoverTrigger>
    <PopoverContent align="end" className="w-80 max-w-[calc(100vw-2rem)]">
      <PopoverTitle className="font-semibold">Periodo personalizado</PopoverTitle>
      <div className="flex flex-col gap-4">
        <Field data-invalid={issue("from") ? true : undefined}>
          <FieldLabel htmlFor="metrics-custom-from">Desde</FieldLabel>
          <DatePickerField id="metrics-custom-from" allowPast className="w-full" value={draft.from} error={issue("from")} onChange={from => setDraft({ ...draft, from })} />
        </Field>
        <Field data-invalid={issue("to") ? true : undefined}>
          <FieldLabel htmlFor="metrics-custom-to">Hasta</FieldLabel>
          <DatePickerField id="metrics-custom-to" allowPast className="w-full" value={draft.to} error={issue("to")} onChange={to => setDraft({ ...draft, to })} />
        </Field>
        {error && <FieldError>{error}</FieldError>}
        <p className="text-xs text-muted-foreground">Máximo 366 días, ambos incluidos · hora del centro de México.</p>
        <Button type="button" className="min-h-10" disabled={issues.length > 0} onClick={() => { onApply(draft); setOpen(false); }}>Aplicar periodo</Button>
      </div>
    </PopoverContent>
  </Popover>;
}
