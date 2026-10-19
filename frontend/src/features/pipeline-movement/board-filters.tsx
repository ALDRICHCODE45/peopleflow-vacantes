"use client";
import { useRef, useState } from "react";
import { SlidersHorizontal, X } from "lucide-react";
import { ActionBar } from "@/components/feedback/action-status";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { activeFilterCount, clearFilters, filterChips, optionCount, toggleFilter, type FilterDimension, type FilterSelection } from "./filters";

type Props<Item> = { items: readonly Item[]; dimensions: FilterDimension<Item>[]; selection: FilterSelection; onChange: (selection: FilterSelection) => void; resultCount: number };
export function BoardFilters<Item>({ items, dimensions, selection, onChange, resultCount }: Props<Item>) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const count = activeFilterCount(selection);
  return <Sheet open={open} onOpenChange={setOpen}>
    <SheetTrigger render={<Button ref={trigger} id="board-filters" type="button" variant="outline" className="min-h-10" />}>
      <SlidersHorizontal aria-hidden="true" data-icon="inline-start" />Filtros{count > 0 && <Badge variant="secondary">{count}</Badge>}
    </SheetTrigger>
    <SheetContent side="right" showCloseButton={false} finalFocus={trigger}>
      <SheetHeader><SheetTitle>Filtros</SheetTitle><SheetDescription>Combina varios valores; se muestran los candidatos que cumplen todos los grupos.</SheetDescription>
        <SheetClose render={<Button type="button" variant="ghost" size="icon" className="absolute top-3 right-3 size-10" aria-label="Cerrar filtros" />}><X aria-hidden="true" /></SheetClose>
      </SheetHeader>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6"><FieldGroup>
        {dimensions.map(dimension => <FieldSet key={dimension.key}><FieldLegend>{dimension.label}</FieldLegend><FieldGroup className="gap-1">
          {[...new Set(dimension.options.map(option => option.group))].map(group => {
            const options = dimension.options.filter(option => option.group === group).map(option => {
            const id = `filter-${dimension.key}-${option.value}`;
            return <Field key={option.value} orientation="horizontal"><FieldLabel htmlFor={id} className="min-h-10 flex-1">
              <Checkbox id={id} checked={selection[dimension.key]?.has(option.value) ?? false} onCheckedChange={() => onChange(toggleFilter(selection, dimension.key, option.value))} />
              <span className="min-w-0 flex-1 break-words">{option.label}</span><span className="text-muted-foreground tabular-nums">{optionCount(items, dimension, option.value)}</span>
            </FieldLabel></Field>;
            });
            return group ? <FieldSet key={group}><FieldLegend variant="label">{group}</FieldLegend><FieldGroup className="gap-1">{options}</FieldGroup></FieldSet> : <FieldGroup key="ungrouped" className="gap-1">{options}</FieldGroup>;
          })}
        </FieldGroup></FieldSet>)}
      </FieldGroup></div>
      <p role="status" aria-live="polite" className="sr-only">Mostrando {resultCount} de {items.length} candidatos</p>
      <SheetFooter className="flex-row"><ActionBar status={null}><Button type="button" variant="ghost" className="min-h-10" onClick={() => onChange(clearFilters(selection))}>Limpiar</Button><Button type="button" className="min-h-10" onClick={() => setOpen(false)}>Ver {resultCount} candidatos</Button></ActionBar></SheetFooter>
    </SheetContent>
  </Sheet>;
}
export function BoardFilterChips<Item>({ dimensions, selection, onChange, resultCount, total }: Omit<Props<Item>, "items"> & { total: number }) {
  if (!activeFilterCount(selection)) return null;
  return <div className="flex shrink-0 flex-wrap items-center gap-2" aria-label="Filtros activos">
    {filterChips(dimensions, selection).map(chip => <Button key={`${chip.key}-${chip.value}`} type="button" variant="outline" className="min-h-10 max-w-full whitespace-normal" aria-label={`Quitar ${chip.label}`} onClick={() => onChange(toggleFilter(selection, chip.key, chip.value))}>{chip.label}<X aria-hidden="true" data-icon="inline-end" /></Button>)}
    <Button type="button" variant="ghost" className="min-h-10" onClick={() => onChange(clearFilters(selection))}>Limpiar filtros</Button>
    <p role="status" aria-live="polite" className="text-xs text-muted-foreground">Mostrando {resultCount} de {total} candidatos</p>
  </div>;
}
