"use client";
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

/** Every active value as a removable chip with its full text; wraps on any width and stays above the results. */
export function ActiveChips({ chips, onChange, onClear }: { chips: Chip[]; onChange: (patch: AuditFilters) => void; onClear: () => void }) {
  if (chips.length === 0) return null;
  return <div role="group" aria-label="Filtros activos" className="flex min-w-0 flex-wrap items-center gap-2">
    {chips.map(chip => <FilterChip key={chip.key} chip={chip} onRemove={() => onChange(chip.remove)} />)}
    <Button type="button" variant="ghost" className="min-h-10" onClick={onClear}>Limpiar filtros</Button>
  </div>;
}

export function OptionsNotice({ failed, onRetry }: { failed: boolean; onRetry: () => void }) {
  if (!failed) return null;
  return <p className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">No pudimos cargar las opciones de persona y vacante.<Button type="button" variant="link" className="min-h-10" onClick={onRetry}>Reintentar opciones</Button></p>;
}
