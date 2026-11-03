"use client";

import { useState, type ReactNode } from "react";
import { es } from "date-fns/locale";
import { CalendarDays, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { isDateStale, type Delivery, type DeliveryErrors, type DeliveryState } from "@/features/jobs/drafts/pipeline/delivery-model";

type BusinessCalendar = Delivery["calendar"];

function localDate(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(0); date.setFullYear(year, month - 1, day); date.setHours(0, 0, 0, 0); return date;
}
function civilDate(date: Date): string {
  return `${String(date.getFullYear()).padStart(4, "0")}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function isSelectable(calendar: BusinessCalendar, date: string): boolean {
  return date >= calendar.minDate && date <= calendar.maxDate && !calendar.nonBusinessDates.includes(date);
}

// Business-day date field (rules §13.5): Mexico working days inside the calendar window the backend sends.
// Every id derives from `id`, so the same field serves the delivery commitment and the recruiter deadline.
export function BusinessDateField({ id, label, description, value, calendar, errorMessage, warning, clearLabel = "Quitar fecha", disabled, onChange }: {
  id: string; label: string; description: string; value: string | null; calendar: BusinessCalendar;
  errorMessage?: string; warning?: ReactNode; clearLabel?: string; disabled: boolean; onChange: (value: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = value ? localDate(value) : undefined;
  const defaultDate = value && value >= calendar.minDate && value <= calendar.maxDate ? value : calendar.minDate;
  return <Field data-invalid={!!errorMessage} data-disabled={disabled}>
    <FieldLabel htmlFor={id} id={`${id}-label`}><CalendarDays aria-hidden="true" className="size-3.5" />{label}</FieldLabel>
    <div className="flex flex-wrap items-center gap-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger render={<Button id={id} type="button" variant="outline" className="min-h-10 min-w-0 max-w-full justify-between overflow-hidden font-normal" disabled={disabled}
          aria-labelledby={`${id}-label`} aria-invalid={!!errorMessage} aria-describedby={`${id}-description${errorMessage ? ` ${id}-error` : ""}${warning ? ` ${id}-warning` : ""}`}>
          <CalendarDays aria-hidden="true" data-icon="inline-start" />
          <span className="min-w-0 flex-1 truncate text-left">{selected ? selected.toLocaleDateString("es", { day: "numeric", month: "long", year: "numeric" }) : "Elige una fecha"}</span>
        </Button>} />
        <PopoverContent align="start" className="w-auto p-0">
          {open && <Calendar captionLayout="dropdown" className="[--cell-size:--spacing(10)]" mode="single" locale={es} selected={selected} today={localDate(calendar.today)} defaultMonth={localDate(defaultDate)}
            startMonth={localDate(calendar.minDate)} endMonth={localDate(calendar.maxDate)}
            disabled={date => !isSelectable(calendar, civilDate(date))}
            onSelect={date => { if (date && isSelectable(calendar, civilDate(date))) { onChange(civilDate(date)); setOpen(false); } }} />}
        </PopoverContent>
      </Popover>
      {selected && <Button type="button" variant="ghost" className="min-h-10" disabled={disabled} onClick={() => onChange(null)}>{clearLabel}</Button>}
    </div>
    <FieldDescription id={`${id}-description`}>{description}</FieldDescription>
    {errorMessage && <FieldError id={`${id}-error`}>{errorMessage}</FieldError>}
    {warning && <p id={`${id}-warning`} className="flex items-start gap-2 text-sm text-status-review"><TriangleAlert aria-hidden="true" className="size-4 shrink-0" />{warning}</p>}
  </Field>;
}

export function formatCommitmentDate(value: string | null): string {
  return value ? localDate(value).toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" }) : "Sin definir";
}

export function PublishedCommitmentField({ value, action }: { value: string | null; action: ReactNode }) {
  return <Field>
    <FieldLabel id="delivery-commitment-label"><CalendarDays aria-hidden="true" className="size-3.5" />Fecha compromiso</FieldLabel>
    <div className="flex flex-wrap items-center gap-3">
      <p aria-labelledby="delivery-commitment-label">{value ? <time dateTime={value}>{formatCommitmentDate(value)}</time> : "Sin definir"}</p>
      {action}
    </div>
  </Field>;
}

export function DeliveryDateField({ state, error, disabled, onChange }: {
  state: DeliveryState; error?: DeliveryErrors["commitmentDate"]; disabled: boolean; onChange: (value: string | null) => void;
}) {
  const message = error === "outside_window" ? "Elige un día hábil dentro del próximo año." : error === "non_business_day" ? "Ese día no es hábil. Elige otro." : undefined;
  return <BusinessDateField id="delivery-date" label="Fecha compromiso" value={state.commitmentDate} calendar={state.calendar} errorMessage={message} disabled={disabled} onChange={onChange}
    description="Días hábiles en México entre hoy y dentro de un año. Fines de semana y días de descanso obligatorio no se pueden elegir."
    warning={isDateStale(state) ? "La fecha compromiso ya pasó; elige otra antes de publicar." : undefined} />;
}
