"use client";

import { useState } from "react";
import { es } from "date-fns/locale";
import { CalendarDays } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { isSelectableRequestDate, type ManagementErrors, type ManagementState } from "@/features/jobs/drafts/pipeline/management-model";

function localDate(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(0); date.setFullYear(year, month - 1, day); date.setHours(0, 0, 0, 0); return date;
}
function civilDate(date: Date): string {
  return `${String(date.getFullYear()).padStart(4, "0")}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export function ManagementDateField({ state, error, disabled, onChange }: {
  state: ManagementState; error?: ManagementErrors["requestDate"]; disabled: boolean; onChange: (value: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = state.requestDate ? localDate(state.requestDate) : undefined;
  const defaultDate = state.requestDate && isSelectableRequestDate(state, state.requestDate) ? state.requestDate : state.today;
  const message = error ? "Elige hoy o una fecha pasada." : undefined;
  return <Field data-invalid={!!message} data-disabled={disabled}>
    <FieldLabel htmlFor="management-date" id="management-date-label"><CalendarDays aria-hidden="true" className="size-3.5" />Fecha de solicitud</FieldLabel>
    <div className="flex flex-wrap items-center gap-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger render={<Button id="management-date" type="button" variant="outline" className="min-h-10 min-w-0 max-w-full justify-between overflow-hidden font-normal" disabled={disabled}
          aria-labelledby="management-date-label" aria-invalid={!!message} aria-describedby={`management-date-description${message ? " management-date-error" : ""}`}>
          <CalendarDays aria-hidden="true" data-icon="inline-start" />
          <span className="min-w-0 flex-1 truncate text-left">{selected ? selected.toLocaleDateString("es", { day: "numeric", month: "long", year: "numeric" }) : "Elige una fecha"}</span>
        </Button>} />
        <PopoverContent align="start" className="w-auto p-0">
          {open && <Calendar className="[--cell-size:--spacing(10)]" mode="single" locale={es} selected={selected} today={localDate(state.today)} defaultMonth={localDate(defaultDate)}
            endMonth={localDate(state.today)} disabled={date => !isSelectableRequestDate(state, civilDate(date))}
            onSelect={date => { if (date && isSelectableRequestDate(state, civilDate(date))) { onChange(civilDate(date)); setOpen(false); } }} />}
        </PopoverContent>
      </Popover>
      {selected && <Button type="button" variant="ghost" className="min-h-10" disabled={disabled} onClick={() => onChange(null)}>Quitar fecha</Button>}
    </div>
    <FieldDescription id="management-date-description">Cuándo te pidieron cubrir esta vacante. Puede ser hoy o una fecha pasada.</FieldDescription>
    {message && <FieldError id="management-date-error">{message}</FieldError>}
  </Field>;
}
