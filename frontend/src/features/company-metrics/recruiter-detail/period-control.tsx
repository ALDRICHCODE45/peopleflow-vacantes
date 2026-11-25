"use client";
import { useEffect, useState } from "react";
import { CalendarRange } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DatePickerField } from "@/components/ui/date-picker-field";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { matchingShortcut, periodIssues, shortcutPeriod, type Period, type Shortcut } from "../period";

/**
 * Rule 11: the period as a segmented control in the header, the same shortcuts and «Personalizado» as the board's
 * header (`metrics-header.tsx`, which does not export them), so both pages read the same.
 */
const PERIODS: { value: Shortcut; label: string }[] = [
  { value: "last_30", label: "30 días" }, { value: "last_90", label: "90 días" }, { value: "last_12_months", label: "12 meses" },
];
const OPTION = "min-h-10 rounded-lg px-3 text-muted-foreground";
const COMPACT_OPTION = "max-md:flex-auto max-md:px-2 max-md:whitespace-nowrap";
const SELECTED = "bg-primary/10 font-semibold text-primary-text hover:bg-primary/15 hover:text-primary-text";

/**
 * `compact`: on a phone the four options share one full-width line (no icon, tighter padding, «Otro rango» for «Personalizado») instead of wrapping onto a
 * second one. The chips size to their content and share what is left (`flex-auto`, never narrower than their label), so none is clipped: measured in
 * Chromium and Firefox with Inter, the four labels need 310 px at most (with «Otro rango» selected) of the 322 px the group has at 360 px and the 352 px at 390 px.
 * Below about 330 px wide the group would overflow by a few px; no supported phone is that narrow.
 */
export function PeriodControl({ period, today, error, compact, className, onChange }: { period: Period; today: string; error?: string; compact?: boolean; className?: string; onChange: (next: Period) => void }) {
  const shortcut = matchingShortcut(period, today);
  const option = cn(OPTION, compact && COMPACT_OPTION);
  // Rule 14: on a narrow screen the options wrap onto a second line, «Personalizado» whole (unless `compact`: one line).
  return <div role="group" aria-label="Periodo" className={cn("flex max-w-full rounded-xl border bg-card p-0.5", compact ? "flex-nowrap max-md:w-full md:flex-wrap" : "flex-wrap", className)}>
    {PERIODS.map(item => <Button key={item.value} type="button" variant="ghost" aria-pressed={shortcut === item.value}
      className={cn(option, shortcut === item.value && SELECTED)} onClick={() => onChange(shortcutPeriod(item.value, today))}>{item.label}</Button>)}
    <CustomPeriod period={period} active={!shortcut} error={error} compact={compact} onApply={onChange} />
  </div>;
}

/** «Personalizado»: a draft period applied only when valid; the page keeps the last valid period meanwhile. */
function CustomPeriod({ period, active, error, compact, onApply }: { period: Period; active: boolean; error?: string; compact?: boolean; onApply: (next: Period) => void }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(period);
  useEffect(() => { if (open) setDraft(period); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const issues = periodIssues(draft);
  const issue = (field: "from" | "to") => issues.find(item => item.field === field)?.message;
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger render={<Button type="button" variant="ghost" aria-pressed={active} className={cn(OPTION, compact && COMPACT_OPTION, active && SELECTED)} />}>
      <CalendarRange aria-hidden="true" data-icon="inline-start" className={cn(compact && "max-md:hidden")} />
      {compact ? <><span className="md:hidden">Otro rango</span><span className="max-md:hidden">Personalizado</span></> : "Personalizado"}
    </PopoverTrigger>
    <PopoverContent align="end" className="w-80 max-w-[calc(100vw-2rem)]">
      <PopoverTitle className="font-semibold">Periodo personalizado</PopoverTitle>
      <div className="flex flex-col gap-4">
        <Field data-invalid={issue("from") ? true : undefined}>
          <FieldLabel htmlFor="recruiter-custom-from">Desde</FieldLabel>
          <DatePickerField id="recruiter-custom-from" allowPast className="w-full" value={draft.from} error={issue("from")} onChange={from => setDraft({ ...draft, from })} />
        </Field>
        <Field data-invalid={issue("to") ? true : undefined}>
          <FieldLabel htmlFor="recruiter-custom-to">Hasta</FieldLabel>
          <DatePickerField id="recruiter-custom-to" allowPast className="w-full" value={draft.to} error={issue("to")} onChange={to => setDraft({ ...draft, to })} />
        </Field>
        {error && <FieldError>{error}</FieldError>}
        <p className="text-xs text-muted-foreground">Máximo 366 días, ambos incluidos · hora del centro de México.</p>
        <Button type="button" className="min-h-10" disabled={issues.length > 0} onClick={() => { onApply(draft); setOpen(false); }}>Aplicar periodo</Button>
      </div>
    </PopoverContent>
  </Popover>;
}
