"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Plus, Search, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { BLOCK_LIBRARY_V2 } from "../defaults";
import { defaultInsertIndex, type EditorState } from "../editor-state";
import { NEW_BLOCK_TYPES, type BlockTypeV2 } from "../model";
import { TALENT_CTA_ENABLED } from "../sections-v2";
import { sectionOptions } from "./forms/v2-fields";
import { offeredVariants, VARIANT_LABELS, VariantThumbnail } from "./variant-picker";

/** What the live preview draws while the library is open: the new section at its index. */
export type LibraryPreview = { type: BlockTypeV2; variant: string; index: number } | null;
type Category = "all" | "presentation" | "culture" | "jobs" | "new";
const GROUPS = [
  { id: "presentation", title: "Presentación", chip: "Presentación", types: ["hero", "story", "values", "stats", "video"] },
  { id: "culture", title: "Cultura y personas", chip: "Cultura", types: ["benefits", "gallery", "testimonials", "team", "logos"] },
  { id: "jobs", title: "Vacantes y contacto", chip: "Vacantes", types: ["jobs", "areas", "talent_cta", "process", "offices", "faq", "closing"] },
] as const satisfies readonly { id: Exclude<Category, "all" | "new">; title: string; chip: string; types: readonly BlockTypeV2[] }[];
const isNew = (type: BlockTypeV2) => (NEW_BLOCK_TYPES as readonly string[]).includes(type);
/** «Llamado a talento» needs its CV form (slice C): never offered before it ships. */
export const offeredTypes = (types: readonly BlockTypeV2[]) => types.filter(type => type !== "talent_cta" || TALENT_CTA_ENABLED);
const normalize = (value: string) => value.toLocaleLowerCase("es").normalize("NFD").replace(/\p{Diacritic}/gu, "");
const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
export const LIBRARY_LIMIT_REASON = "Llegaste al límite de 30 secciones.";
export const LIBRARY_PROTECTED_REASON = "Ya está en tu sitio; solo puede haber una.";

type Props = {
  editor: EditorState;
  onAdd: (type: BlockTypeV2, variant: string, index: number) => void;
  onClose: () => void;
  /** Reports the insertion the preview should show; null when nothing is chosen or on close. */
  onPreview: (preview: LibraryPreview) => void;
};
/** Visual «Agregar sección» (S4): a thumbnail per section and per layout, filters,
 * search, and where it goes. The caller decides the surface (docked panel or Sheet). */
function useLibrary({ editor, onPreview }: Pick<Props, "editor" | "onPreview">) {
  const blocks = editor.draft.blocks;
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<Category>("all");
  const [type, setType] = useState<BlockTypeV2 | null>(null);
  const [variant, setVariant] = useState<string | null>(null);
  const [after, setAfter] = useState(() => {
    const index = defaultInsertIndex(blocks, editor.selectedId) - 1;
    return blocks[Math.max(0, index)]?.id ?? null;
  });
  const afterIndex = Math.max(0, blocks.findIndex(block => block.id === after));
  const index = afterIndex + 1;
  const full = blocks.length >= 30;
  const chosenVariant = type ? variant ?? offeredVariants(type)[0] : null;
  useEffect(() => { onPreview(type && chosenVariant && !full ? { type, variant: chosenVariant, index } : null); }, [type, chosenVariant, index, full, onPreview]);
  useEffect(() => () => onPreview(null), [onPreview]);
  const matches = (candidate: BlockTypeV2) => {
    const { label, description } = BLOCK_LIBRARY_V2[candidate];
    return normalize(`${label} ${description}`).includes(normalize(query.trim()));
  };
  const groups = GROUPS.map(group => ({ ...group, types: offeredTypes(group.types).filter(candidate =>
    (category === "all" || category === group.id || (category === "new" && isNew(candidate))) && matches(candidate)) })).filter(group => group.types.length > 0);
  const newCount = offeredTypes(NEW_BLOCK_TYPES).length;
  return { blocks, query, setQuery, category, setCategory, type, setType, variant: chosenVariant, setVariant, after, setAfter, afterIndex, index, full, groups, newCount };
}
type Library = ReturnType<typeof useLibrary>;

function reason(type: BlockTypeV2, full: boolean) {
  return type === "hero" || type === "jobs" ? LIBRARY_PROTECTED_REASON : full ? LIBRARY_LIMIT_REASON : null;
}
function Tools({ library, searchRef }: { library: Library; searchRef?: React.Ref<HTMLInputElement> }) {
  const id = useId();
  return <div className="flex min-w-0 flex-col gap-3">
    <Field><FieldLabel htmlFor={`${id}-q`} className="sr-only">Buscar una sección</FieldLabel>
      <InputGroup><InputGroupInput ref={searchRef} id={`${id}-q`} placeholder="Buscar una sección" autoComplete="off" value={library.query} onChange={event => library.setQuery(event.target.value)} /><InputGroupAddon><Search aria-hidden="true" /></InputGroupAddon></InputGroup>
    </Field>
    <ToggleGroup aria-label="Filtrar por tipo" variant="outline" size="sm" className="flex w-full flex-wrap" value={[library.category]} onValueChange={values => { if (values[0]) library.setCategory(values[0] as Category); }}>
      {([["all", "Todas"], ...GROUPS.map(group => [group.id, group.chip]), ["new", `Nuevas · ${library.newCount}`]] as [Category, string][]).map(([value, label]) =>
        <ToggleGroupItem key={value} value={value} className="min-h-10 aria-pressed:border-primary aria-pressed:bg-primary/10 aria-pressed:text-foreground">{label}</ToggleGroupItem>)}
    </ToggleGroup>
  </div>;
}
function Types({ library }: { library: Library }) {
  const id = useId();
  if (!library.groups.length) return <p role="status" className="text-sm text-muted-foreground">No encontramos secciones con ese nombre.</p>;
  return <div className="flex min-w-0 flex-col gap-4">
    <h3 className="sr-only">Secciones disponibles</h3>
    {library.groups.map(group => <section key={group.id} aria-labelledby={`${id}-${group.id}`} className="flex min-w-0 flex-col gap-2">
      <h4 id={`${id}-${group.id}`} className="text-xs font-medium text-muted-foreground">{group.title}</h4>
      <ToggleGroup aria-labelledby={`${id}-${group.id}`} variant="outline" className="grid w-full grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] items-stretch" value={library.type ? [library.type] : []}
        onValueChange={values => { if (values[0]) { library.setType(values[0] as BlockTypeV2); library.setVariant(null); } }}>
        {group.types.map(type => {
          const why = reason(type, library.full);
          const layouts = offeredVariants(type).length;
          return <ToggleGroupItem key={type} value={type} disabled={why !== null} aria-label={BLOCK_LIBRARY_V2[type].label} aria-describedby={`${id}-${type}`} data-library-type={type}
            className="h-auto min-w-0 flex-col items-stretch gap-2 p-2 text-left whitespace-normal aria-pressed:border-primary aria-pressed:bg-primary/10 aria-pressed:text-foreground">
            <span className="pointer-events-none block h-16 w-full"><VariantThumbnail variant={offeredVariants(type)[0]} /></span>
            <span className="flex min-w-0 flex-wrap items-center gap-1 text-sm font-medium">{BLOCK_LIBRARY_V2[type].label}{isNew(type) && <Badge variant="secondary">Nueva</Badge>}</span>
            <span id={`${id}-${type}`} className="text-xs font-normal text-muted-foreground">{why ?? plural(layouts, "diseño", "diseños")}</span>
          </ToggleGroupItem>;
        })}
      </ToggleGroup>
    </section>)}
  </div>;
}
function Layouts({ library }: { library: Library }) {
  const id = useId();
  const type = library.type;
  if (!type) return <p className="text-sm text-muted-foreground">Elige una sección para ver sus diseños.</p>;
  return <section aria-labelledby={`${id}-title`} className="flex min-w-0 flex-col gap-2">
    <h3 id={`${id}-title`} className="text-base font-semibold">{BLOCK_LIBRARY_V2[type].label}</h3>
    <p id={`${id}-description`} className="text-sm text-muted-foreground">{BLOCK_LIBRARY_V2[type].description} Podrás cambiar el diseño después sin perder el contenido.</p>
    <ToggleGroup aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`} variant="outline" className="grid w-full grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] items-stretch" value={library.variant ? [library.variant] : []}
      onValueChange={values => { if (values[0]) library.setVariant(values[0]); }}>
      {offeredVariants(type).map(variant => <ToggleGroupItem key={variant} value={variant} aria-label={`Diseño ${VARIANT_LABELS[variant]}`} className="h-auto min-w-0 flex-col items-stretch gap-2 p-2 whitespace-normal aria-pressed:border-primary aria-pressed:bg-primary/10 aria-pressed:text-foreground">
        <span className="pointer-events-none block h-16 w-full"><VariantThumbnail variant={variant} /></span><span className="text-center text-sm">{VARIANT_LABELS[variant]}</span>
      </ToggleGroupItem>)}
    </ToggleGroup>
  </section>;
}
function Placement({ library }: { library: Library }) {
  const id = useId();
  const options = sectionOptions(library.blocks);
  const label = options[library.afterIndex]?.label;
  return <div className="flex min-w-0 flex-col gap-2">
    <Field orientation="horizontal" className="flex-wrap">
      <FieldLabel htmlFor={`${id}-after`} className="shrink-0">Insertar después de</FieldLabel>
      <Select items={options} value={library.after} onValueChange={value => { if (value) library.setAfter(String(value)); }}>
        <SelectTrigger id={`${id}-after`} className="min-h-10 min-w-0 flex-1" aria-describedby={`${id}-hint`}><SelectValue /></SelectTrigger>
        <SelectContent><SelectGroup>{options.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectGroup></SelectContent>
      </Select>
    </Field>
    <p id={`${id}-hint`} className="text-xs text-muted-foreground">Portada siempre va primero. Después puedes moverla desde la lista.</p>
    <p role="status" className="sr-only">{library.type && label ? `Se insertará ${BLOCK_LIBRARY_V2[library.type].label} después de ${label}.` : ""}</p>
  </div>;
}
function AddButton({ library, onAdd }: { library: Library; onAdd: Props["onAdd"] }) {
  const type = library.type; const label = type ? BLOCK_LIBRARY_V2[type].label : null;
  return <Button className="min-h-10" disabled={!type || !library.variant || library.full} onClick={() => { if (type && library.variant) onAdd(type, library.variant, library.index); }}>
    <Plus data-icon="inline-start" aria-hidden="true" />{label ? `Agregar «${label}»` : "Agregar sección"}
  </Button>;
}

/** Desktop: docked beside the live preview (non-modal, so the preview shows the insertion). */
export function SectionLibraryPanel({ editor, onAdd, onClose, onPreview }: Props) {
  const library = useLibrary({ editor, onPreview });
  const search = useRef<HTMLInputElement>(null);
  const id = useId();
  useEffect(() => { search.current?.focus(); }, []);
  // A docked region, not a Dialog: Base UI dialogs are modal surfaces that would cover
  // the live preview this flow depends on (S4). Escape and the close button still dismiss it.
  return <section data-section-library="" aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`} onKeyDown={event => { if (event.key === "Escape" && !event.defaultPrevented) { event.preventDefault(); onClose(); } }}
    className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-2xl border bg-card text-card-foreground shadow-sm">
    <header className="flex shrink-0 items-start justify-between gap-3 border-b p-4">
      <div className="flex min-w-0 flex-col gap-1"><h2 id={`${id}-title`} className="text-lg font-semibold">Agregar sección</h2><p id={`${id}-description`} className="text-sm text-muted-foreground">Elige una sección y su diseño. La vista previa te muestra dónde quedará.</p></div>
      <Button variant="ghost" size="icon" className="size-10 shrink-0" aria-label="Cerrar biblioteca" onClick={onClose}><X aria-hidden="true" /></Button>
    </header>
    <div className="shrink-0 border-b p-4"><Tools library={library} searchRef={search} /></div>
    <div className="@container min-h-0 flex-1 overflow-y-auto p-4">
      <div className="grid min-w-0 gap-6 @2xl:grid-cols-[minmax(0,1fr)_minmax(0,16rem)]"><Types library={library} /><Layouts library={library} /></div>
    </div>
    <footer className="flex shrink-0 flex-col gap-3 border-t p-4">
      <Placement library={library} />
      <div className="flex flex-wrap justify-end gap-2"><Button variant="outline" className="min-h-10" onClick={onClose}>Cancelar</Button><AddButton library={library} onAdd={onAdd} /></div>
    </footer>
  </section>;
}

/** Phone and tablet: the same library in a Sheet (the preview isn't beside it there). */
export function SectionLibrarySheet({ open, onOpenChange, editor, onAdd }: Omit<Props, "onClose" | "onPreview"> & { open: boolean; onOpenChange: (open: boolean) => void }) {
  const noPreview = useMemo(() => () => {}, []);
  return <Sheet open={open} onOpenChange={onOpenChange}>
    <SheetContent side="bottom" showCloseButton={false} className="max-h-[calc(100dvh-2*var(--sheet-inset,0px))]">
      {open && <SheetBody editor={editor} onAdd={onAdd} onClose={() => onOpenChange(false)} onPreview={noPreview} />}
    </SheetContent>
  </Sheet>;
}
function SheetBody({ editor, onAdd, onClose, onPreview }: Props) {
  const library = useLibrary({ editor, onPreview });
  return <>
    <SheetHeader className="border-b"><SheetTitle>Agregar sección</SheetTitle><SheetDescription>Elige una sección y su diseño. Después puedes moverla desde la lista.</SheetDescription></SheetHeader>
    <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-4"><Tools library={library} /><Types library={library} /><Layouts library={library} /></div>
    <SheetFooter className="border-t"><Placement library={library} /><div className="flex flex-wrap justify-end gap-2"><Button variant="outline" className="min-h-10" onClick={onClose}>Cancelar</Button><AddButton library={library} onAdd={onAdd} /></div></SheetFooter>
  </>;
}
