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
  disabled?: boolean;
  error?: string;
};

/**
 * Controlled Spanish date field over the committed popover, button, and calendar
 * primitives. It rejects past days and emits timezone-safe civil date strings.
 */
export function DatePickerField({
  id,
  value,
  onChange,
  "aria-labelledby": ariaLabelledBy,
  disabled = false,
  error,
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

  function handleSelect(next: Date | undefined) {
    // The matcher hides past days; this guard also blocks a bypassed event.
    if (next === undefined || next.getTime() < today.getTime()) return;
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
              aria-labelledby={ariaLabelledBy}
              aria-invalid={error === undefined ? undefined : true}
              aria-describedby={error === undefined ? undefined : errorId}
              className="w-fit justify-between gap-2 font-normal"
            >
              <CalendarDaysIcon data-icon="inline-start" />
              <span className={cn(display === null && "text-muted-foreground")}>
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
              disabled={{ before: today }}
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
