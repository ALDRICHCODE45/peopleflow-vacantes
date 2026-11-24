"use client";
import { useState, type ComponentProps, type ReactNode } from "react";
import { Briefcase, ChevronDown, ScrollText, User, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import { mxToday, PRESETS, presetRange, rangeKeyOf, type RangeKey } from "./date-range";
import { activeChips } from "./filter-model";
import { ActiveChips, OptionsNotice } from "./filter-chips";
import { ActionPanel, CustomRangePanel, PersonPanel, VacancyPanel } from "./filter-panels";
import { PhoneFilters } from "./audit-filters-phone";
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

export type AuditFiltersBarProps = {
  filters: AuditFilters;
  options: AuditOptions | null;
  optionsFailed: boolean;
  onRetryOptions: () => void;
  onChange: (patch: AuditFilters) => void;
  onClear: () => void;
  /** Table view controls (columns, reset) sit at the end of the toolbar. Desktop only. */
  actions?: ReactNode;
  /** Below `sm`: «Filtros (n)» opens the same panels in a bottom drawer. */
  phone?: boolean;
  /** How many events the current filters match, for the drawer's closing button. */
  total?: number;
};

/** Desktop: the selector bar. Phone: «Filtros (n)» plus the date presets, with the same chips. */
export function AuditFiltersBar({ phone, total, actions, ...props }: AuditFiltersBarProps) {
  return phone ? <PhoneFilters {...props} total={total} /> : <DesktopFilters {...props} actions={actions} />;
}

/** Desktop bar (artboard `audit-log-redesign/01`): Persona / Acción / Vacante open wide searchable panels, the date range is one segmented control with presets (Mexico City days), and every active value is a removable chip with its full text. */
function DesktopFilters({ filters, options, optionsFailed, onRetryOptions, onChange, onClear, actions }: Omit<AuditFiltersBarProps, "phone" | "total">) {
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
    <OptionsNotice failed={optionsFailed} onRetry={onRetryOptions} />
    <ActiveChips chips={chips} onChange={onChange} onClear={onClear} />
  </section>;
}
