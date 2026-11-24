"use client";
import { useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, SlidersHorizontal, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerClose, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import { mxToday, PRESETS, presetRange, rangeKeyOf, type RangeKey } from "./date-range";
import { ActiveChips, OptionsNotice } from "./filter-chips";
import { activeChips } from "./filter-model";
import { ActionPanel, PersonPanel, RangeFields, VacancyPanel } from "./filter-panels";
import type { AuditOptions } from "./model";
import type { AuditFilters } from "./url-state";

type View = "main" | "actor" | "action" | "vacancy";
const number = new Intl.NumberFormat("es-MX");

/** A filter as a 64 px row: its name, what it holds right now and a chevron to its panel (artboard `audit-log-redesign/01`, 390 px). */
function FilterRow({ label, values, empty, onClick }: { label: string; values: string[]; empty: string; onClick: () => void }) {
  return <button type="button" aria-haspopup="dialog" onClick={onClick} className="flex min-h-16 w-full items-center gap-3 rounded-2xl bg-input/50 px-3.5 py-2.5 text-left outline-none focus-visible:outline-2 focus-visible:outline-primary-text">
    <span className="grid min-w-0 flex-1 gap-0.5">
      <span className="text-xs leading-4 font-medium text-muted-foreground">{label}</span>
      {values.length ? values.map(value => <span key={value} className="text-sm [overflow-wrap:anywhere]">{value}</span>) : <span className="text-sm text-muted-foreground">{empty}</span>}
    </span>
    <ChevronRight aria-hidden="true" className="size-5 shrink-0 text-muted-foreground" />
  </button>;
}

const CloseButton = () => <DrawerClose render={<Button type="button" variant="ghost" size="icon" className="absolute top-1 right-2 size-10 bg-secondary" aria-label="Cerrar" />}><X aria-hidden="true" /></DrawerClose>;

function SubView({ title, onBack, children, footer }: { title: string; onBack: () => void; children: ReactNode; footer?: ReactNode }) {
  return <>
    <DrawerHeader className="relative gap-1 py-1 pr-16 pl-14 text-left group-data-[swipe-axis=y]/drawer-popup:text-left">
      <Button type="button" variant="ghost" size="icon" className="absolute top-1 left-2 size-10" aria-label="Volver a Filtros" onClick={onBack}><ChevronLeft aria-hidden="true" /></Button>
      <DrawerTitle className="py-2.5">{title}</DrawerTitle>
      <CloseButton />
    </DrawerHeader>
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">{children}</div>
    {footer && <DrawerFooter>{footer}</DrawerFooter>}
  </>;
}

/**
 * Phone filters (below `sm`, artboard `audit-log-redesign/01` at 390 px): «Filtros (n)» and the date presets on the bar, the chips above
 * the list, and one bottom drawer that holds the same panels — a main view with a row per filter and the date range, and one sub-view per
 * filter with a back arrow.
 */
export function PhoneFilters({ filters, options, optionsFailed, onRetryOptions, onChange, onClear, total }: {
  filters: AuditFilters; options: AuditOptions | null; optionsFailed: boolean; onRetryOptions: () => void;
  onChange: (patch: AuditFilters) => void; onClear: () => void; total?: number;
}) {
  const [view, setView] = useState<View | null>(null);
  // «Personalizado» is a mode, not a range: it stays pressed (and shows Desde / Hasta) before any day is picked.
  const [custom, setCustom] = useState(false);
  // The drawer keeps showing its last view while it slides out, instead of jumping to the main view.
  const lastView = useRef<View>("main");
  if (view) lastView.current = view;
  const shown = lastView.current;
  const today = mxToday();
  const chips = activeChips(filters, options, today);
  const rangeKey = rangeKeyOf(filters, today);
  const pressed: RangeKey | null = custom ? "custom" : rangeKey;
  const count = chips.length;
  const valuesOf = (matches: (id: string) => boolean) => chips.filter(({ key: id }) => matches(id)).map(({ value }) => value);
  const openDrawer = (next: View, wantsCustom = false) => { if (wantsCustom) setCustom(true); setView(next); };
  const back = () => setView("main");
  const done = (patch: AuditFilters) => { onChange(patch); back(); };

  const presets = (className: string) => <ToggleGroup aria-label="Rango de fechas" variant="segmented" className={className} value={pressed ? [pressed] : []}
    onValueChange={(values: string[]) => {
      const choice = values[0] as RangeKey | undefined;
      // «Personalizado» opens the drawer from its own click; pressing nothing with no preset set changes nothing.
      if (choice === "custom" || (!choice && (pressed === "custom" || pressed === null))) return;
      setCustom(false);
      onChange(choice ? presetRange(choice, today) : { from: undefined, to: undefined });
    }}>
    {PRESETS.map(preset => <ToggleGroupItem key={preset.key} value={preset.key} className="min-h-10 flex-1 px-1.5">{preset.label}</ToggleGroupItem>)}
    <ToggleGroupItem value="custom" className="min-h-10 flex-1 px-1.5" aria-haspopup="dialog" onClick={() => openDrawer("main", true)}>Personalizado</ToggleGroupItem>
  </ToggleGroup>;

  const main = <>
    <DrawerHeader className="relative gap-0.5 pr-16 text-left group-data-[swipe-axis=y]/drawer-popup:text-left">
      <DrawerTitle>Filtros</DrawerTitle>
      <DrawerDescription>{count === 0 ? "Ninguno activo" : count === 1 ? "1 activo" : `${count} activos`}</DrawerDescription>
      <CloseButton />
    </DrawerHeader>
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain p-4">
      <FilterRow label="Persona" values={valuesOf(id => id === "actor_id")} empty="Todas las personas" onClick={() => setView("actor")} />
      <FilterRow label="Acción" values={valuesOf(id => id !== "actor_id" && id !== "vacancy_id" && id !== "range")} empty="Todas las acciones" onClick={() => setView("action")} />
      <FilterRow label="Vacante" values={valuesOf(id => id === "vacancy_id")} empty="Todas las vacantes" onClick={() => setView("vacancy")} />
      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">Rango de fechas</span>
        {presets("h-12! w-full")}
        {pressed === "custom" && <RangeFields idPrefix="audit-range" range={filters} onApply={onChange} />}
      </div>
    </div>
    <DrawerFooter className="flex-col-reverse">
      {count > 0 && <Button type="button" variant="ghost" className="min-h-11" onClick={onClear}>Limpiar filtros</Button>}
      <DrawerClose render={<Button type="button" className="min-h-11" />}>{total === undefined ? "Ver eventos" : `Ver ${number.format(total)} ${total === 1 ? "evento" : "eventos"}`}</DrawerClose>
    </DrawerFooter>
  </>;

  return <section aria-label="Filtros de la auditoría" className="flex min-w-0 flex-col gap-3">
    <div data-audit-toolbar className="grid min-w-0 gap-2.5">
      <Button type="button" variant="outline" className={cn("min-h-11 w-full gap-2", count > 0 && "border-primary/35 bg-primary/7")} aria-haspopup="dialog" onClick={() => openDrawer("main")}>
        <SlidersHorizontal aria-hidden="true" />Filtros
        {count > 0 && <span className="grid h-5 min-w-5 place-items-center rounded-full bg-primary px-1.5 text-xs leading-4 font-semibold text-primary-foreground dark:bg-primary-text dark:text-card">{count}<span className="sr-only">{count === 1 ? " activo" : " activos"}</span></span>}
      </Button>
      {presets("h-12! w-full")}
    </div>
    <OptionsNotice failed={optionsFailed} onRetry={onRetryOptions} />
    <ActiveChips chips={chips} onChange={onChange} onClear={onClear} />
    <Drawer open={view !== null} onOpenChange={open => { if (!open) { setView(null); setCustom(false); } }}>
      <DrawerContent>
        {shown === "actor" ? <SubView title="Persona" onBack={back}><PersonPanel actors={options?.actors ?? []} selectedId={filters.actor_id} onPick={id => done({ actor_id: id })} /></SubView>
          : shown === "action" ? <SubView title="Acción" onBack={back} footer={<Button type="button" className="min-h-11" onClick={back}>Listo</Button>}>
            <ActionPanel types={options?.types ?? []} selected={filters.event_type ?? []} onChange={next => onChange({ event_type: next.length ? next : undefined })} /></SubView>
          : shown === "vacancy" ? <SubView title="Vacante" onBack={back}><VacancyPanel vacancies={options?.vacancies ?? []} selectedId={filters.vacancy_id} onPick={id => done({ vacancy_id: id })} /></SubView>
          : main}
      </DrawerContent>
    </Drawer>
  </section>;
}
