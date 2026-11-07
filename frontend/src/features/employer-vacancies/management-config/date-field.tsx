"use client";

import { useState } from "react";
import { es } from "date-fns/locale";
import { CalendarCheck, CalendarDays, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { isCivilDate } from "@/features/jobs/drafts/pipeline/delivery-model";
import { isSelectableRequestDate, type ManagementErrors, type ManagementState } from "@/features/jobs/drafts/pipeline/management-model";

function localDate(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(0); date.setFullYear(year, month - 1, day); date.setHours(0, 0, 0, 0); return date;
}
function civilDate(date: Date): string {
  return `${String(date.getFullYear()).padStart(4, "0")}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function shiftYears(value: string, years: number): string { return `${String(Number(value.slice(0, 4)) + years).padStart(4, "0")}${value.slice(4)}`; }

type CivilDateFieldProps = {
  id: string; label: string; icon: LucideIcon; description: string; clearLabel?: string;
  value: string | null; today: string; startMonth?: string; endMonth: string; message?: string; disabled: boolean;
  isSelectable: (date: string) => boolean; onChange: (value: string | null) => void;
};
function CivilDateField({ id, label, icon: Icon, description, clearLabel, value, today, startMonth, endMonth, message, disabled, isSelectable, onChange }: CivilDateFieldProps) {
  const [open, setOpen] = useState(false);
  const selected = value ? localDate(value) : undefined;
  const defaultDate = value && isSelectable(value) ? value : today;
  return <Field data-invalid={!!message} data-disabled={disabled}>
    <FieldLabel htmlFor={id} id={`${id}-label`}><Icon aria-hidden="true" className="size-3.5" />{label}</FieldLabel>
    <div className="flex flex-wrap items-center gap-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger render={<Button id={id} type="button" variant="outline" className="min-h-10 min-w-0 max-w-full justify-between overflow-hidden font-normal" disabled={disabled}
          aria-labelledby={`${id}-label`} aria-invalid={!!message} aria-describedby={`${id}-description${message ? ` ${id}-error` : ""}`}>
          <Icon aria-hidden="true" data-icon="inline-start" />
          <span className="min-w-0 flex-1 truncate text-left">{selected ? selected.toLocaleDateString("es", { day: "numeric", month: "long", year: "numeric" }) : "Elige una fecha"}</span>
        </Button>} />
        <PopoverContent align="start" className="w-auto p-0">
          {open && <Calendar captionLayout="dropdown" className="[--cell-size:--spacing(10)]" mode="single" locale={es} selected={selected} today={localDate(today)} defaultMonth={localDate(defaultDate)}
            {...(startMonth ? { startMonth: localDate(startMonth) } : {})} endMonth={localDate(endMonth)} disabled={date => !isSelectable(civilDate(date))}
            onSelect={date => { if (date && isSelectable(civilDate(date))) { onChange(civilDate(date)); setOpen(false); } }} />}
        </PopoverContent>
      </Popover>
      {/* The visible text stays inside the accessible name (label in name). */}
      {selected && <Button type="button" variant="ghost" className="min-h-10" disabled={disabled} aria-label={clearLabel} onClick={() => onChange(null)}>Quitar fecha</Button>}
    </div>
    <FieldDescription id={`${id}-description`}>{description}</FieldDescription>
    {message && <FieldError id={`${id}-error`}>{message}</FieldError>}
  </Field>;
}

export function ManagementDateField({ state, error, disabled, onChange }: {
  state: ManagementState; error?: ManagementErrors["requestDate"]; disabled: boolean; onChange: (value: string | null) => void;
}) {
  return <CivilDateField id="management-date" label="Fecha de solicitud" icon={CalendarDays} description="Cuándo te pidieron cubrir esta vacante. Puede ser hoy o una fecha pasada."
    value={state.requestDate} today={state.today} endMonth={state.today} message={error ? "Elige hoy o una fecha pasada." : undefined} disabled={disabled}
    isSelectable={date => isSelectableRequestDate(state, date)} onChange={onChange} />;
}

/** Optional; past dates stay selectable so an older vacancy can still get a target. */
export function TargetCloseDateField({ state, error, disabled, onChange }: {
  state: ManagementState; error?: "invalid" | "rejected"; disabled: boolean; onChange: (value: string | null) => void;
}) {
  const message = error === "rejected" ? "No pudimos guardar esta fecha. Elige otra." : error ? "Elige una fecha válida." : undefined;
  return <CivilDateField id="management-target-close-date" label="Fecha objetivo de cierre" icon={CalendarCheck} clearLabel="Quitar fecha objetivo"
    description="Opcional. Métricas la usa para saber si la vacante cerró en tiempo. Sin esta fecha, la vacante aparece como «Sin objetivo»."
    value={state.targetCloseDate} today={state.today} startMonth={shiftYears(state.today, -5)} endMonth={shiftYears(state.today, 5)} message={message} disabled={disabled}
    isSelectable={isCivilDate} onChange={onChange} />;
}
