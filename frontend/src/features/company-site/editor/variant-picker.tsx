"use client";

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Badge } from "@/components/ui/badge";
import { Field, FieldLabel } from "@/components/ui/field";
import { NEW_VARIANT_LABELS } from "../defaults";
import { variantOptions } from "../editor-state";
import type { BlockTypeV2 } from "../model";
import { SECTIONS_V2_ENABLED } from "../sections-v2";

export const VARIANT_LABELS: Record<string, string> = {
  photo: "Fotográfica", split: "Dividida", centered: "Centrada", text: "Manifiesto", text_image: "Con imagen",
  grid: "Cuadrícula", list: "Lista", compact: "Compacta", row: "En fila", cards: "Tarjetas", steps: "Pasos",
  timeline: "Cronología", mosaic: "Mosaico", carousel: "Carrusel", quote: "Cita", wide: "Panorámica",
  by_area: "Por área", accordion: "Acordeón", two_columns: "Dos columnas", banner: "Banner", simple: "Simple",
  ...NEW_VARIANT_LABELS,
};
/** Layouts slice A adds to existing sections (marked «Nuevo» in the picker). */
export const NEW_VARIANTS: ReadonlySet<string> = new Set(Object.keys(NEW_VARIANT_LABELS));
/** Background video arrives with slice B; until then this layout always blocks
 * publication, so it is never offered, only shown while it is the current one. */
const UNOFFERED_VARIANTS: ReadonlySet<string> = new Set(["background_loop"]);
/** The layouts the picker and the library offer for a section. */
export function offeredVariants(type: BlockTypeV2, current?: string): string[] {
  return variantOptions(type).filter(variant => variant === current || !UNOFFERED_VARIANTS.has(variant));
}
/** Slice A diagrams; same decorative 120 × 64 grammar as the originals. */
function NewVariantShapes({ variant }: { variant: string }) {
  switch (variant) {
    case "background_loop": return <><rect x="6" y="6" width="108" height="52" rx="3" className="fill-muted-foreground/40" /><rect x="33" y="18" width="54" height="5" rx="2" className="fill-background" /><rect x="40" y="28" width="40" height="3" rx="1" className="fill-background/70" /><rect x="42" y="38" width="16" height="7" rx="2" className="fill-background" /><rect x="62" y="38" width="16" height="7" rx="2" className="fill-none stroke-background" /><path d="M100 47v6l5-3z" className="fill-background" /></>;
    case "photo_jobs": return <><rect x="62" y="6" width="52" height="52" rx="3" className="fill-muted" /><rect x="8" y="12" width="44" height="5" rx="2" fill="currentColor" /><rect x="8" y="22" width="36" height="3" rx="1" className="fill-border" />{[32, 41, 50].map(y => <rect key={y} x="8" y={y} width="46" height="6" rx="2" className="fill-background stroke-border" />)}</>;
    case "collage": return <><rect x="8" y="14" width="44" height="5" rx="2" fill="currentColor" /><rect x="8" y="24" width="36" height="3" rx="1" className="fill-border" /><rect x="8" y="34" width="18" height="7" rx="2" className="fill-muted stroke-border" /><rect x="62" y="6" width="30" height="34" rx="3" className="fill-muted stroke-border" /><rect x="84" y="24" width="28" height="30" rx="3" className="fill-muted stroke-border" /><rect x="66" y="44" width="20" height="14" rx="3" className="fill-muted stroke-border" /></>;
    case "bento": return <><rect x="9" y="8" width="50" height="4" rx="2" fill="currentColor" /><rect x="9" y="18" width="62" height="38" rx="3" className="fill-muted stroke-border" /><rect x="75" y="18" width="36" height="17" rx="3" className="fill-muted stroke-border" /><rect x="75" y="39" width="36" height="17" rx="3" className="fill-muted stroke-border" /></>;
    case "big_icons": return <><rect x="9" y="8" width="50" height="4" rx="2" fill="currentColor" />{[9, 46, 83].map(x => <g key={x}><circle cx={x + 14} cy="30" r="9" className="fill-muted stroke-border" /><rect x={x + 3} y="45" width="22" height="3" rx="1" fill="currentColor" /><rect x={x + 5} y="51" width="18" height="2" rx="1" className="fill-border" /></g>)}</>;
    case "brand_band": return <><rect x="1" y="14" width="118" height="36" className="fill-foreground/80" />{[12, 50, 88].map(x => <g key={x}><rect x={x} y="22" width="22" height="9" rx="2" className="fill-background" /><rect x={x} y="36" width="18" height="3" rx="1" className="fill-background/70" /></g>)}</>;
    case "photo_strip": return <><rect x="9" y="8" width="50" height="4" rx="2" fill="currentColor" />{[-6, 22, 50, 78, 106].map((x, i) => <rect key={x} x={x} y={i % 2 ? 22 : 18} width="24" height={i % 2 ? 30 : 34} rx="3" className="fill-muted stroke-border" />)}</>;
    case "portraits": return <><rect x="9" y="8" width="50" height="4" rx="2" fill="currentColor" />{[24, 60, 96].map(x => <g key={x}><circle cx={x} cy="32" r="12" className="fill-muted stroke-border" /><rect x={x - 11} y="49" width="22" height="3" rx="1" fill="currentColor" /></g>)}</>;
    case "strip": return <><rect x="33" y="12" width="54" height="4" rx="2" fill="currentColor" />{[10, 38, 66, 94].map(x => <rect key={x} x={x} y="30" width="18" height="8" rx="2" className="fill-muted-foreground/40" />)}</>;
    case "icon_cards": return <><rect x="9" y="8" width="50" height="4" rx="2" fill="currentColor" />{[9, 46, 83].flatMap(x => [18, 38].map(y => <g key={`${x}-${y}`}><rect x={x} y={y} width="28" height="16" rx="3" className="fill-background stroke-border" /><rect x={x + 4} y={y + 4} width="6" height="6" rx="1" className="fill-muted-foreground/50" /></g>))}</>;
    case "photo_cards": return <><rect x="9" y="8" width="50" height="4" rx="2" fill="currentColor" />{[9, 46, 83].map(x => <g key={x}><rect x={x} y="18" width="28" height="36" rx="3" className="fill-muted-foreground/40" /><rect x={x + 4} y="46" width="16" height="3" rx="1" className="fill-background" /></g>)}</>;
    default: return null;
  }
}
/** Decorative diagrams only; selection and keyboard behavior belong to ToggleGroup.
 * Unlike v0's nested live pages, these never duplicate headings, IDs or controls. */
export function VariantThumbnail({ variant }: { variant: string }) {
  const columns = ["split", "text_image", "two_columns"].includes(variant);
  const cards = ["grid", "cards", "mosaic"].includes(variant);
  return <svg aria-hidden="true" viewBox="0 0 120 64" className="size-full text-muted-foreground" fill="none">
    <rect x="1" y="1" width="118" height="62" rx="4" className="fill-background stroke-border" />
    {NEW_VARIANTS.has(variant) ? <NewVariantShapes variant={variant} /> : variant === "carousel" ? <>{[9, 50, 91].map(x => <rect key={x} x={x} y="14" width="34" height="36" rx="3" className="fill-muted stroke-border" />)}</> : variant === "by_area" ? <>{[10, 34].map(y => <g key={y}><rect x="10" y={y} width="32" height="3" rx="1" fill="currentColor" /><rect x="10" y={y + 8} width="99" height="9" rx="2" className="fill-muted stroke-border" /></g>)}</> : columns ? <><rect x="8" y="12" width="45" height="4" rx="2" fill="currentColor" /><rect x="8" y="22" width="38" height="3" rx="1" className="fill-border" /><rect x="8" y="30" width="42" height="3" rx="1" className="fill-border" /><rect x="65" y="10" width="46" height="43" rx="3" className="fill-muted" /></> : cards ? <><rect x="9" y="9" width="55" height="4" rx="2" fill="currentColor" />{[9, 44, 79].map((x, i) => <rect key={x} x={x} y={21 + (variant === "mosaic" ? i * 4 : 0)} width="30" height={variant === "mosaic" ? 29 - i * 4 : 30} rx="3" className="fill-muted stroke-border" />)}</> : ["centered", "photo", "banner", "wide", "quote"].includes(variant) ? <><rect x="33" y="11" width="54" height="5" rx="2" fill="currentColor" /><rect x="25" y="23" width="70" height="3" rx="1" className="fill-border" />{variant === "centered" ? <rect x="45" y="37" width="30" height="9" rx="3" className="fill-muted stroke-border" /> : <rect x="15" y="33" width="90" height="20" rx="3" className="fill-muted" />}</> : <>{[12, 28, 44].map((y, i) => <g key={y}><rect x={variant === "timeline" ? 12 + i * 4 : 10} y={y} width={variant === "row" ? 25 : 10} height="8" rx="2" className="fill-muted stroke-border" /><rect x="44" y={y} width={variant === "simple" ? 48 : 65} height="3" rx="1" fill="currentColor" /><rect x="44" y={y + 6} width="46" height="2" rx="1" className="fill-border" /></g>)}</>}
  </svg>;
}
/** `labelHidden`: inside the «Diseño de sección» group, whose title already names it. */
export function VariantPicker({ block, onChange, labelHidden = false }: { block: { id: string; type: BlockTypeV2; variant: string }; onChange: (variant: string) => void; labelHidden?: boolean }) {
  const options = offeredVariants(block.type, block.variant);
  // Only slice A layouts on existing sections are «new»; a new section's layouts aren't.
  const marked = (variant: string) => SECTIONS_V2_ENABLED && NEW_VARIANTS.has(variant) && !["portraits", "strip", "icon_cards", "photo_cards"].includes(variant);
  return <Field><FieldLabel id={`variants-${block.id}`} className={labelHidden ? "sr-only" : undefined}>Diseño de sección</FieldLabel>
    <ToggleGroup aria-labelledby={`variants-${block.id}`} value={[block.variant]} onValueChange={values => { if (values[0]) onChange(values[0]); }} className="grid w-full grid-cols-2 items-stretch" variant="outline">
      {options.map(variant => <ToggleGroupItem key={variant} value={variant} aria-label={`Diseño ${VARIANT_LABELS[variant]}`} className="h-auto min-w-0 flex-col data-pressed:inset-ring-2 data-pressed:inset-ring-primary">
        <span data-variant-content="" className="flex w-full min-w-0 flex-col gap-2 py-3"><span data-variant-thumbnail="" className="pointer-events-none block h-18 w-full"><VariantThumbnail variant={variant} /></span><span className={SECTIONS_V2_ENABLED ? "flex min-w-0 flex-wrap items-center justify-center gap-1 text-center whitespace-normal" : undefined}>{VARIANT_LABELS[variant]}{marked(variant) && <Badge variant="secondary">Nuevo</Badge>}</span></span>
      </ToggleGroupItem>)}
    </ToggleGroup>
  </Field>;
}
