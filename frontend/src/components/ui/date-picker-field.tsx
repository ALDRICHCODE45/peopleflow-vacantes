"use client";

import * as React from "react";
import { es } from "date-fns/locale";
import { CalendarDaysIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

const PLACEHOLDER = "Elegí una fecha";
const CIVIL_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/u;

/** Strict `YYYY-MM-DD` to local date; impossible days such as `2026-02-30` fail. */
function toLocalDate(value: string): Date | undefined {
  const match = CIVIL_DATE_PATTERN.exec(value);
  if (match === null) return undefined;
  const [, year, month, day] = match.map(Number);
  const date = new Date(year, month - 1, day);
  const isCivilDay =
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day;
  return isCivilDay ? date : undefined;
}

/** Serializes a picked day from local getters, the only shape this field emits. */
function toCivilDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

export type DatePickerFieldProps = {
  id: string;
  /** Civil date as `YYYY-MM-DD`, or any other string while nothing is picked. */
  value: string;
  onChange: (next: string) => void;
  "aria-labelledby"?: string;
  /** Optional profile marker forwarded to the trigger so callers can locate the control. */
  "data-pf-profile-field"?: string;
  disabled?: boolean;
  error?: string;
  /** Opens the past window (birth dates) while still blocking future days. */
  allowPast?: boolean;
  /** Extra trigger classes, e.g. `w-full` for a full-width profile control. */
  className?: string;
};

/**
 * Controlled Spanish date field over the committed popover, button, and calendar
 * primitives. It rejects out-of-range days (`allowPast` flips the open window from
 * future-only to past-only) and emits timezone-safe civil date strings.
 */
export function DatePickerField({
  id,
  value,
  onChange,
  "aria-labelledby": ariaLabelledBy,
  "data-pf-profile-field": dataProfileField,
  disabled = false,
  error,
  allowPast = false,
  className,
}: DatePickerFieldProps) {
  const [open, setOpen] = React.useState(false);
  const [today] = React.useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  });
  const selected = toLocalDate(value);
  const errorId = `${id}-error`;
  const display = selected
    ? selected.toLocaleDateString("es", {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : null;
  // Future-only by default; birth dates flip the open window to the past.
  const disabledDays = allowPast ? { after: today } : { before: today };

  function handleSelect(next: Date | undefined) {
    if (next === undefined) return;
    // The matcher hides the out-of-range days; this guard also blocks a bypassed event.
    const picked = new Date(next.getFullYear(), next.getMonth(), next.getDate()).getTime();
    if (allowPast ? picked > today.getTime() : picked < today.getTime()) return;
    onChange(toCivilDate(next));
    setOpen(false);
  }

  return (
    <div data-slot="date-picker-field" className="flex flex-col gap-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <Button
              id={id}
              type="button"
              variant="outline"
              disabled={disabled}
              data-pf-profile-field={dataProfileField}
              aria-labelledby={ariaLabelledBy}
              aria-invalid={error === undefined ? undefined : true}
              aria-describedby={error === undefined ? undefined : errorId}
              className={cn("min-h-10 min-w-0 w-fit justify-between gap-2 overflow-hidden font-normal", className)}
            >
              <CalendarDaysIcon data-icon="inline-start" />
              <span className={cn("min-w-0 flex-1 truncate text-left", display === null && "text-muted-foreground")}>
                {display ?? PLACEHOLDER}
              </span>
            </Button>
          }
        />
        <PopoverContent align="start" className="w-auto p-0">
          {open ? (
            <Calendar
              mode="single"
              locale={es}
              selected={selected}
              defaultMonth={selected ?? today}
              disabled={disabledDays}
              onSelect={handleSelect}
            />
          ) : null}
        </PopoverContent>
      </Popover>
      {error === undefined ? null : (
        <p id={errorId} className="text-sm text-destructive">{error}</p>
      )}
    </div>
  );
}
