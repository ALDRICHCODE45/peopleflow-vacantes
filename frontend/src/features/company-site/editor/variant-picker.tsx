"use client";

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Field, FieldLabel } from "@/components/ui/field";
import { blockSchema, type SiteBlock } from "../model";

export const VARIANT_LABELS: Record<string, string> = {
  photo: "Fotográfica", split: "Dividida", centered: "Centrada", text: "Manifiesto", text_image: "Con imagen",
  grid: "Cuadrícula", list: "Lista", compact: "Compacta", row: "En fila", cards: "Tarjetas", steps: "Pasos",
  timeline: "Cronología", mosaic: "Mosaico", carousel: "Carrusel", quote: "Cita", wide: "Panorámica",
  by_area: "Por área", accordion: "Acordeón", two_columns: "Dos columnas", banner: "Banner", simple: "Simple",
};
/** Decorative diagrams only; selection and keyboard behavior belong to ToggleGroup.
 * Unlike v0's nested live pages, these never duplicate headings, IDs or controls. */
function VariantThumbnail({ variant }: { variant: string }) {
  const columns = ["split", "text_image", "two_columns"].includes(variant);
  const cards = ["grid", "cards", "mosaic"].includes(variant);
  return <svg aria-hidden="true" viewBox="0 0 120 64" className="size-full text-muted-foreground" fill="none">
    <rect x="1" y="1" width="118" height="62" rx="4" className="fill-background stroke-border" />
    {variant === "carousel" ? <>{[9, 50, 91].map(x => <rect key={x} x={x} y="14" width="34" height="36" rx="3" className="fill-muted stroke-border" />)}</> : variant === "by_area" ? <>{[10, 34].map(y => <g key={y}><rect x="10" y={y} width="32" height="3" rx="1" fill="currentColor" /><rect x="10" y={y + 8} width="99" height="9" rx="2" className="fill-muted stroke-border" /></g>)}</> : columns ? <><rect x="8" y="12" width="45" height="4" rx="2" fill="currentColor" /><rect x="8" y="22" width="38" height="3" rx="1" className="fill-border" /><rect x="8" y="30" width="42" height="3" rx="1" className="fill-border" /><rect x="65" y="10" width="46" height="43" rx="3" className="fill-muted" /></> : cards ? <><rect x="9" y="9" width="55" height="4" rx="2" fill="currentColor" />{[9, 44, 79].map((x, i) => <rect key={x} x={x} y={21 + (variant === "mosaic" ? i * 4 : 0)} width="30" height={variant === "mosaic" ? 29 - i * 4 : 30} rx="3" className="fill-muted stroke-border" />)}</> : ["centered", "photo", "banner", "wide", "quote"].includes(variant) ? <><rect x="33" y="11" width="54" height="5" rx="2" fill="currentColor" /><rect x="25" y="23" width="70" height="3" rx="1" className="fill-border" />{variant === "centered" ? <rect x="45" y="37" width="30" height="9" rx="3" className="fill-muted stroke-border" /> : <rect x="15" y="33" width="90" height="20" rx="3" className="fill-muted" />}</> : <>{[12, 28, 44].map((y, i) => <g key={y}><rect x={variant === "timeline" ? 12 + i * 4 : 10} y={y} width={variant === "row" ? 25 : 10} height="8" rx="2" className="fill-muted stroke-border" /><rect x="44" y={y} width={variant === "simple" ? 48 : 65} height="3" rx="1" fill="currentColor" /><rect x="44" y={y + 6} width="46" height="2" rx="1" className="fill-border" /></g>)}</>}
  </svg>;
}
export function VariantPicker({ block, onChange }: { block: SiteBlock; onChange: (variant: string) => void }) {
  const options = blockSchema.options.find(option => option.shape.type.value === block.type)!.shape.variant.options;
  return <Field><FieldLabel id={`variants-${block.id}`}>Diseño de sección</FieldLabel>
    <ToggleGroup aria-labelledby={`variants-${block.id}`} value={[block.variant]} onValueChange={values => { if (values[0]) onChange(values[0]); }} className="grid w-full grid-cols-2 items-stretch" variant="outline">
      {options.map(variant => <ToggleGroupItem key={variant} value={variant} aria-label={`Diseño ${VARIANT_LABELS[variant]}`} className="h-auto min-w-0 flex-col data-pressed:ring-2 data-pressed:ring-primary">
        <span data-variant-content="" className="flex w-full flex-col gap-2 py-3"><span data-variant-thumbnail="" className="pointer-events-none block h-18 w-full"><VariantThumbnail variant={variant} /></span><span>{VARIANT_LABELS[variant]}</span></span>
      </ToggleGroupItem>)}
    </ToggleGroup>
  </Field>;
}
