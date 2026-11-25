"use client";
import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Chip } from "./filter-model";
import type { AuditFilters } from "./url-state";

export function FilterChip({ chip, onRemove }: { chip: Chip; onRemove: () => void }) {
  return <span data-slot="audit-chip" className="inline-flex max-w-full items-start rounded-xl bg-card pl-3 text-sm leading-5 shadow-[inset_0_0_0_1px_var(--border)]">
    <span className="min-w-0 py-2.5 pr-1 [overflow-wrap:anywhere]"><span className="text-muted-foreground">{`${chip.name}:`}</span>{" "}<b className="font-medium [overflow-wrap:anywhere]">{chip.value}</b></span>
    <Button type="button" variant="ghost" size="icon" title="Quitar" aria-label={`Quitar filtro ${chip.name}: ${chip.value}`} className="size-10 shrink-0 rounded-xl text-muted-foreground" onClick={onRemove}><X aria-hidden="true" /></Button>
  </span>;
}

/**
 * Every active value as a removable chip with its full text; wraps on any width and stays above the results. Removing a chip hands the
 * focus to the next chip (the last one when it was the final chip), and to the filter bar's first control once none remain
 * (`onEmpty`), so the keyboard never falls back to the page.
 */
export function ActiveChips({ chips, onChange, onClear, onEmpty }: { chips: Chip[]; onChange: (patch: AuditFilters) => void; onClear: () => void; onEmpty: () => void }) {
  const group = useRef<HTMLDivElement>(null);
  // Index of the chip that took the focus before it was removed, or -1 after «Limpiar filtros».
  const removed = useRef<number | null>(null);
  useEffect(() => {
    const index = removed.current;
    if (index === null) return;
    removed.current = null;
    const buttons = group.current?.querySelectorAll<HTMLElement>("[data-slot=audit-chip] button");
    if (index >= 0 && buttons?.length) buttons[Math.min(index, buttons.length - 1)].focus();
    else onEmpty();
  }, [chips, onEmpty]);
  if (chips.length === 0) return null;
  return <div ref={group} role="group" aria-label="Filtros activos" className="flex min-w-0 flex-wrap items-center gap-2">
    {chips.map((chip, index) => <FilterChip key={chip.key} chip={chip} onRemove={() => { removed.current = index; onChange(chip.remove); }} />)}
    <Button type="button" variant="ghost" className="min-h-10" onClick={() => { removed.current = -1; onClear(); }}>Limpiar filtros</Button>
  </div>;
}

export function OptionsNotice({ failed, onRetry }: { failed: boolean; onRetry: () => void }) {
  if (!failed) return null;
  return <p className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">No pudimos cargar las opciones de persona y vacante.<Button type="button" variant="link" className="min-h-10" onClick={onRetry}>Reintentar opciones</Button></p>;
}
