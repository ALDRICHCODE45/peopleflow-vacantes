"use client";
import { useState, type ComponentProps, type ReactNode } from "react";
import { Briefcase, ChevronDown, ScrollText, User, X, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import { mxToday, PRESETS, presetRange, rangeKeyOf, type RangeKey } from "./date-range";
import { activeChips, type Chip } from "./filter-model";
import { ActionPanel, CustomRangePanel, PersonPanel, VacancyPanel } from "./filter-panels";
import type { AuditOptions } from "./model";
import type { AuditFilters } from "./url-state";

type PanelKey = "actor" | "action" | "vacancy" | "range";

/** Selector button: the name and how many values it holds; the values themselves live in the chips below. */
function SelectorButton({ icon: Icon, label, count, active, ...props }: { icon: LucideIcon; label: string; count: number; active: boolean } & Omit<ComponentProps<typeof Button>, "children">) {
  return <Button {...props} type="button" variant="outline" className={cn("min-h-10 gap-2", count > 0 && "border-primary/35 bg-primary/7")} aria-haspopup="dialog">
    <Icon aria-hidden="true" />{label}
    {count > 0 && <span className="grid h-5 min-w-5 place-items-center rounded-full bg-primary px-1.5 text-xs leading-4 font-semibold text-primary-foreground dark:bg-primary-text dark:text-card">{count}<span className="sr-only">{count === 1 ? " elegido" : " elegidos"}</span></span>}
    <ChevronDown aria-hidden="true" className={cn("transition-transform", active && "rotate-180")} />
  </Button>;
}

function FilterChip({ chip, onRemove }: { chip: Chip; onRemove: () => void }) {
  return <span data-slot="audit-chip" className="inline-flex max-w-full items-start rounded-xl bg-card pl-3 text-sm leading-5 shadow-[inset_0_0_0_1px_var(--border)]">
    <span className="min-w-0 py-2.5 pr-1 [overflow-wrap:anywhere]"><span className="text-muted-foreground">{`${chip.name}:`}</span>{" "}<b className="font-medium [overflow-wrap:anywhere]">{chip.value}</b></span>
    <Button type="button" variant="ghost" size="icon" title="Quitar" aria-label={`Quitar filtro ${chip.name}: ${chip.value}`} className="size-10 shrink-0 rounded-xl text-muted-foreground" onClick={onRemove}><X aria-hidden="true" /></Button>
  </span>;
}

/**
 * One filter bar (artboard `audit-log-redesign/01`): Persona / Acción / Vacante open wide searchable panels, the date range is one
 * segmented control with presets (Mexico City days), and every active value is a removable chip with its full text.
 */
export function AuditFiltersBar({ filters, options, optionsFailed, onRetryOptions, onChange, onClear, actions }: {
  filters: AuditFilters;
  options: AuditOptions | null;
  optionsFailed: boolean;
  onRetryOptions: () => void;
  onChange: (patch: AuditFilters) => void;
  onClear: () => void;
  /** Table view controls (columns, reset) sit at the end of the toolbar. */
  actions?: ReactNode;
}) {
  const [open, setOpen] = useState<PanelKey | null>(null);
  const today = mxToday();
  const selectedTypes = filters.event_type ?? [];
  const chips = activeChips(filters, options, today);
  const panel = (key: PanelKey) => ({ open: open === key, onOpenChange: (next: boolean) => setOpen(next ? key : null) });
  const pick = (patch: AuditFilters) => { onChange(patch); setOpen(null); };
  const rangeKey = rangeKeyOf(filters, today);
  const pressed: RangeKey | null = open === "range" ? "custom" : rangeKey;

  return <section aria-label="Filtros de la auditoría" className="flex min-w-0 flex-col gap-3">
    <div data-audit-toolbar className="flex min-w-0 flex-wrap items-center gap-2.5">
      <Popover {...panel("actor")}>
        <PopoverTrigger render={<SelectorButton icon={User} label="Persona" count={filters.actor_id ? 1 : 0} active={open === "actor"} />} />
        <PopoverContent align="start" aria-label="Filtrar por persona" className="w-[min(420px,calc(100vw-2rem))] gap-3 p-3"><PersonPanel actors={options?.actors ?? []} selectedId={filters.actor_id} onPick={id => pick({ actor_id: id })} /></PopoverContent>
      </Popover>
      <Popover {...panel("action")}>
        <PopoverTrigger render={<SelectorButton icon={ScrollText} label="Acción" count={selectedTypes.length} active={open === "action"} />} />
        <PopoverContent align="start" aria-label="Filtrar por acción" className="w-[min(460px,calc(100vw-2rem))] gap-3 p-3"><ActionPanel types={options?.types ?? []} selected={selectedTypes} onChange={next => onChange({ event_type: next.length ? next : undefined })} /></PopoverContent>
      </Popover>
      <Popover {...panel("vacancy")}>
        <PopoverTrigger render={<SelectorButton icon={Briefcase} label="Vacante" count={filters.vacancy_id ? 1 : 0} active={open === "vacancy"} />} />
        <PopoverContent align="start" aria-label="Filtrar por vacante" className="w-[min(460px,calc(100vw-2rem))] gap-3 p-3"><VacancyPanel vacancies={options?.vacancies ?? []} selectedId={filters.vacancy_id} onPick={id => pick({ vacancy_id: id })} /></PopoverContent>
      </Popover>
      <span aria-hidden="true" className="mx-1 hidden h-6 w-px bg-border sm:block" />
      <Popover {...panel("range")}>
        <ToggleGroup aria-label="Rango de fechas" variant="segmented" className="h-11! max-w-full overflow-x-auto" value={pressed ? [pressed] : []}
          onValueChange={(values: string[]) => {
            const key = values[0] as RangeKey | undefined;
            // «Personalizado» is the popover trigger below; pressing nothing with no range set changes nothing.
            if (key === "custom" || (!key && (rangeKey === "custom" || rangeKey === null))) return;
            setOpen(null);
            onChange(key ? presetRange(key, today) : { from: undefined, to: undefined });
          }}>
          {PRESETS.map(preset => <ToggleGroupItem key={preset.key} value={preset.key} className="min-h-9">{preset.label}</ToggleGroupItem>)}
          <PopoverTrigger render={<ToggleGroupItem value="custom" className="min-h-9" aria-haspopup="dialog">Personalizado</ToggleGroupItem>} />
        </ToggleGroup>
        <PopoverContent align="start" aria-label="Rango personalizado" className="w-[min(360px,calc(100vw-2rem))] gap-3 p-3">
          <CustomRangePanel range={filters} onApply={onChange} onClear={() => pick({ from: undefined, to: undefined })} onDone={() => setOpen(null)} />
        </PopoverContent>
      </Popover>
      {actions && <div className="ml-auto flex min-w-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
    {optionsFailed && <p className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">No pudimos cargar las opciones de persona y vacante.<Button type="button" variant="link" className="min-h-10" onClick={onRetryOptions}>Reintentar opciones</Button></p>}
    {chips.length > 0 && <div role="group" aria-label="Filtros activos" className="flex min-w-0 flex-wrap items-center gap-2">
      {chips.map(chip => <FilterChip key={chip.key} chip={chip} onRemove={() => onChange(chip.remove)} />)}
      <Button type="button" variant="ghost" className="min-h-10" onClick={onClear}>Limpiar filtros</Button>
    </div>}
  </section>;
}
