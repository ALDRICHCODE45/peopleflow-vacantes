"use client";
import { Fragment, useRef, useState } from "react";
import { ArrowRight, ChevronDown, Info, RotateCcw, Search, SlidersHorizontal, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { plural } from "@/features/employer-vacancies/pipeline-board";
import { cn } from "@/lib/utils";
import type { BoardFilterDimension } from "./board-filter-dimensions";
import { activeFilterCount, clearFilters, filterChips, optionCount, toggleFilter, type FilterSelection } from "./filters";

type Props<Item> = { items: readonly Item[]; dimensions: BoardFilterDimension<Item>[]; selection: FilterSelection; onChange: (selection: FilterSelection) => void; resultCount: number };

function FilterControl<Item>({ dimension, items, selection, onChange }: Pick<Props<Item>, "items" | "selection" | "onChange"> & { dimension: BoardFilterDimension<Item> }) {
  const [search, setSearch] = useState("");
  const searchInput = useRef<HTMLInputElement>(null);
  const presentation = dimension.presentation;
  const label = presentation?.label ?? dimension.label;
  const selected = dimension.options.filter(option => selection[dimension.key]?.has(option.value));
  const summary = selected.length > 2
    ? plural(selected.length, presentation?.singular ?? "opción", presentation?.plural ?? "opciones")
    : selected.map(option => option.label).join(", ");
  const options = dimension.options.filter(option => option.label.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  const id = `filter-${dimension.key}`;
  return <Field>
    <FieldLabel htmlFor={id}>{label}</FieldLabel>
    <Popover onOpenChange={() => setSearch("")}>
      <PopoverTrigger render={<Button id={id} type="button" variant="outline" aria-label={label} aria-describedby={`${id}-help`} className="h-12 w-full justify-between" />}>
        <span className={cn("truncate", !selected.length && "text-muted-foreground")}>{summary || presentation?.placeholder || "Todas las opciones"}</span>
        <ChevronDown aria-hidden="true" data-icon="inline-end" />
      </PopoverTrigger>
      <PopoverContent initialFocus={searchInput} align="start" aria-label={label} className="max-h-(--available-height) w-(--anchor-width) max-w-[calc(100vw-2rem)] gap-3 overflow-hidden p-2">
        <InputGroup className="h-10 shrink-0">
          <InputGroupAddon><Search aria-hidden="true" /></InputGroupAddon>
          <InputGroupInput ref={searchInput} aria-label="Buscar opciones…" placeholder="Buscar opciones…" value={search} onChange={event => setSearch(event.target.value)} />
        </InputGroup>
        <div className="min-h-0 max-h-64 flex-1 overflow-y-auto px-2">
          <FieldGroup className="gap-3">
            {[...new Set(options.map(option => option.group))].map(group => <FieldSet key={group ?? "options"} className="gap-2">
              <FieldLegend variant="label" className="text-muted-foreground">{group ?? "Opciones"}</FieldLegend>
              <FieldGroup className="gap-0">
                {options.filter(option => option.group === group).map(option => {
                  const count = optionCount(items, dimension, option.value);
                  return <Field key={option.value} orientation="horizontal">
                    <FieldLabel className="min-h-11 w-full" htmlFor={`${id}-${option.value}`}>
                      <Checkbox id={`${id}-${option.value}`} checked={selection[dimension.key]?.has(option.value) ?? false} onCheckedChange={() => onChange(toggleFilter(selection, dimension.key, option.value))} />
                      <span className="min-w-0 flex-1 break-words">{option.label}</span>
                      <span data-slot="option-count" className={cn("text-muted-foreground tabular-nums", count === 0 && "opacity-50")}>{count}</span>
                    </FieldLabel>
                  </Field>;
                })}
              </FieldGroup>
            </FieldSet>)}
            {!options.length && <p className="py-3 text-sm text-muted-foreground">No se encontraron opciones.</p>}
          </FieldGroup>
        </div>
        <Separator />
        <p className="shrink-0 px-2 pb-1 text-xs text-muted-foreground">Puedes seleccionar más de una opción.</p>
      </PopoverContent>
    </Popover>
    <FieldDescription id={`${id}-help`}>{presentation?.helper}</FieldDescription>
  </Field>;
}

export function BoardFilters<Item>({ items, dimensions, selection, onChange, resultCount }: Props<Item>) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const count = activeFilterCount(selection);
  const sections = [...new Set(dimensions.map(dimension => dimension.presentation?.section.key))];
  return <Sheet open={open} onOpenChange={setOpen}>
    <SheetTrigger render={<Button ref={trigger} id="board-filters" type="button" variant="outline" className="min-h-10" />}>
      <SlidersHorizontal aria-hidden="true" data-icon="inline-start" />Filtros{count > 0 && <Badge variant="secondary">{count}</Badge>}
    </SheetTrigger>
    <SheetContent side="right" showCloseButton={false} finalFocus={trigger} className="gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-md">
      <SheetHeader className="shrink-0 border-b p-6">
        <div data-slot="filter-icon" className="mb-2 flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary"><SlidersHorizontal aria-hidden="true" className="size-5" /></div>
        <SheetTitle>Filtrar candidatos</SheetTitle>
        <SheetDescription>Encuentra los perfiles que necesitas dentro de tu pipeline.</SheetDescription>
        <SheetClose render={<Button type="button" variant="ghost" size="icon" className="absolute top-5 right-5 size-10" aria-label="Cerrar filtros" />}><X aria-hidden="true" /></SheetClose>
      </SheetHeader>
      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        <FieldGroup className="gap-7">
          {sections.map((key, index) => {
            const fields = dimensions.filter(dimension => dimension.presentation?.section.key === key);
            const section = fields[0].presentation?.section;
            const Icon = section?.icon ?? SlidersHorizontal;
            return <Fragment key={key ?? "filters"}>
              {index > 0 && <Separator />}
              <section className="flex flex-col gap-5" aria-label={section?.label ?? "Filtros"}>
                <h3 className="flex items-center gap-2 text-xs font-medium text-muted-foreground"><Icon aria-hidden="true" className="size-4" />{section?.label ?? "FILTROS"}</h3>
                <FieldGroup className="gap-6">{fields.map(dimension => <FilterControl key={dimension.key} dimension={dimension} items={items} selection={selection} onChange={onChange} />)}</FieldGroup>
              </section>
            </Fragment>;
          })}
          <div className="flex items-start gap-3 rounded-xl bg-muted p-4 text-sm text-muted-foreground">
            <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            <p>Las opciones de un mismo filtro se suman. Entre filtros, los candidatos deben cumplir <strong className="font-medium text-foreground">todas las condiciones</strong>.</p>
          </div>
        </FieldGroup>
      </div>
      <p role="status" aria-live="polite" className="sr-only">Mostrando {resultCount} de {plural(items.length, "candidato", "candidatos")}</p>
      <SheetFooter className="shrink-0 gap-4 border-t p-6">
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <p className="font-semibold">{plural(resultCount, "candidato coincide", "candidatos coinciden")}</p>
          <p className="text-muted-foreground">{count ? plural(count, "filtro activo", "filtros activos") : "Sin filtros activos"}</p>
        </div>
        <div className="flex items-center justify-between gap-3">
          <Button type="button" variant="ghost" className="min-h-10" disabled={!count} onClick={() => onChange(clearFilters(selection))}><RotateCcw aria-hidden="true" data-icon="inline-start" />Limpiar</Button>
          <Button type="button" className="min-h-10" onClick={() => setOpen(false)}>Ver {plural(resultCount, "candidato", "candidatos")}<ArrowRight aria-hidden="true" data-icon="inline-end" /></Button>
        </div>
      </SheetFooter>
    </SheetContent>
  </Sheet>;
}
export function BoardFilterChips<Item>({ dimensions, selection, onChange, resultCount, total }: Omit<Props<Item>, "items"> & { total: number }) {
  if (!activeFilterCount(selection)) return null;
  return <div className="flex shrink-0 flex-wrap items-center gap-2" aria-label="Filtros activos">
    {filterChips(dimensions, selection).map(chip => <Button key={`${chip.key}-${chip.value}`} type="button" variant="outline" className="min-h-10 max-w-full whitespace-normal" aria-label={`Quitar ${chip.label}`} onClick={() => onChange(toggleFilter(selection, chip.key, chip.value))}>{chip.label}<X aria-hidden="true" data-icon="inline-end" /></Button>)}
    <Button type="button" variant="ghost" className="min-h-10" onClick={() => onChange(clearFilters(selection))}>Limpiar filtros</Button>
    <p role="status" aria-live="polite" className="text-xs text-muted-foreground">Mostrando {resultCount} de {plural(total, "candidato", "candidatos")}</p>
  </div>;
}
