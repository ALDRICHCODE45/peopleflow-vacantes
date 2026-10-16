"use client";

import { useState } from "react";
import { es } from "date-fns/locale";
import { CalendarDays, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { isDateStale, isSelectableDate, type DeliveryErrors, type DeliveryState } from "@/features/jobs/drafts/pipeline/delivery-model";

function localDate(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(0); date.setFullYear(year, month - 1, day); date.setHours(0, 0, 0, 0); return date;
}
function civilDate(date: Date): string {
  return `${String(date.getFullYear()).padStart(4, "0")}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export function DeliveryDateField({ state, error, disabled, onChange }: {
  state: DeliveryState; error?: DeliveryErrors["commitmentDate"]; disabled: boolean; onChange: (value: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = state.commitmentDate ? localDate(state.commitmentDate) : undefined;
  const defaultDate = state.commitmentDate && state.commitmentDate >= state.calendar.minDate && state.commitmentDate <= state.calendar.maxDate ? state.commitmentDate : state.calendar.minDate;
  const message = error === "outside_window" ? "Elige un día hábil dentro del próximo año." : error === "non_business_day" ? "Ese día no es hábil. Elige otro." : undefined;
  return <Field data-invalid={!!message} data-disabled={disabled}>
    <FieldLabel htmlFor="delivery-date" id="delivery-date-label"><CalendarDays aria-hidden="true" className="size-3.5" />Fecha compromiso</FieldLabel>
    <div className="flex flex-wrap items-center gap-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger render={<Button id="delivery-date" type="button" variant="outline" className="min-h-10 min-w-0 max-w-full justify-between overflow-hidden font-normal" disabled={disabled}
          aria-labelledby="delivery-date-label" aria-invalid={!!message} aria-describedby={`delivery-date-description${message ? " delivery-date-error" : ""}${isDateStale(state) ? " delivery-date-warning" : ""}`}>
          <CalendarDays aria-hidden="true" data-icon="inline-start" />
          <span className="min-w-0 flex-1 truncate text-left">{selected ? selected.toLocaleDateString("es", { day: "numeric", month: "long", year: "numeric" }) : "Elige una fecha"}</span>
        </Button>} />
        <PopoverContent align="start" className="w-auto p-0">
          {open && <Calendar className="[--cell-size:--spacing(10)]" mode="single" locale={es} selected={selected} today={localDate(state.calendar.today)} defaultMonth={localDate(defaultDate)}
            startMonth={localDate(state.calendar.minDate)} endMonth={localDate(state.calendar.maxDate)}
            disabled={date => !isSelectableDate(state, civilDate(date))}
            onSelect={date => { if (date && isSelectableDate(state, civilDate(date))) { onChange(civilDate(date)); setOpen(false); } }} />}
        </PopoverContent>
      </Popover>
      {selected && <Button type="button" variant="ghost" className="min-h-10" disabled={disabled} onClick={() => onChange(null)}>Quitar fecha</Button>}
    </div>
    <FieldDescription id="delivery-date-description">Días hábiles en México entre hoy y dentro de un año. Fines de semana y días de descanso obligatorio no se pueden elegir.</FieldDescription>
    {message && <FieldError id="delivery-date-error">{message}</FieldError>}
    {isDateStale(state) && <p id="delivery-date-warning" className="flex items-start gap-2 text-sm text-status-review"><TriangleAlert aria-hidden="true" className="size-4 shrink-0" />La fecha compromiso ya pasó; elige otra antes de publicar.</p>}
  </Field>;
}
