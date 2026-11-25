"use client";
import { useState } from "react";
import { es } from "date-fns/locale";
import { CalendarDaysIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { shortDay } from "./date-range";

const CIVIL_DAY = /^(\d{4})-(\d{2})-(\d{2})$/u;
function toLocalDate(value: string): Date | undefined {
  const match = CIVIL_DAY.exec(value);
  if (match === null) return undefined;
  const [, year, month, day] = match.map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : undefined;
}
const toCivilDay = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

/**
 * Past-days date field of the audit filters and the export panel. Same behaviour as the shared `DatePickerField` (`allowPast`: any day up to
 * today, civil `YYYY-MM-DD` out), but the trigger reads the artboard's short day («26 oct 2026»): the long «26 de octubre de 2026» is cut
 * off in a 360 px panel or in a two-column phone sheet, and a date must never be truncated.
 */
export function AuditDateField({ id, value, onChange }: { id: string; value: string; onChange: (next: string) => void }) {
  const [open, setOpen] = useState(false);
  const [today] = useState(() => { const now = new Date(); return new Date(now.getFullYear(), now.getMonth(), now.getDate()); });
  const selected = toLocalDate(value);
  return <div data-slot="date-picker-field" className="flex flex-col gap-2">
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button id={id} type="button" variant="outline" className="min-h-10 w-full min-w-0 justify-between gap-2 font-normal">
        <CalendarDaysIcon data-icon="inline-start" aria-hidden="true" />
        <span className={cn("min-w-0 flex-1 text-left whitespace-nowrap", !selected && "text-muted-foreground")}>{selected ? shortDay(toCivilDay(selected)) : "Elige una fecha"}</span>
      </Button>} />
      <PopoverContent align="start" className="w-auto p-0">
        {open ? <Calendar captionLayout="dropdown" mode="single" locale={es} selected={selected} defaultMonth={selected ?? today} disabled={{ after: today }}
          onSelect={next => {
            if (next === undefined) return;
            if (new Date(next.getFullYear(), next.getMonth(), next.getDate()).getTime() > today.getTime()) return;
            onChange(toCivilDay(next));
            setOpen(false);
          }} /> : null}
      </PopoverContent>
    </Popover>
  </div>;
}
