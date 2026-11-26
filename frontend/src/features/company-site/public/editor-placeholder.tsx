"use client";
import { createContext, useContext, type ComponentType, type ReactNode, type SVGProps } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { deriveDraftDescriptionPlain } from "@/features/jobs/drafts/rich/plain";
import type { SiteBlockV2 } from "../model";

/**
 * Editor preview only. The public page never provides this context, so every slot
 * below renders its children untouched there (no wrapper, identical markup).
 * In the editor each section provides it; a slot whose required part is still
 * empty (items, story text, video, a required title) shows where that part goes.
 */
export type EditorPlaceholder = { block: SiteBlockV2; icon: ComponentType<SVGProps<SVGSVGElement>>; onComplete?: () => void };
export const EditorPlaceholderContext = createContext<EditorPlaceholder | null>(null);
export const useEditorPlaceholder = () => useContext(EditorPlaceholderContext);

const filled = (value: unknown) => typeof value === "string" ? value.trim() !== "" : value !== null && value !== undefined;
/** Whether the person already typed or added anything (defaults such as the CV button text don't count).
 * Untouched sections keep the generic blank card; anything else renders what was typed. */
export function hasDraftContent(block: SiteBlockV2): boolean {
  switch (block.type) {
    case "hero": case "jobs": return true;
    case "story": return filled(block.content.title) || filled(deriveDraftDescriptionPlain(block.content.body)) || filled(block.content.image);
    case "values": return filled(block.content.mission) || block.content.items.length > 0;
    case "video": return filled(block.content.title) || filled(block.content.description) || filled(block.content.video);
    case "closing": return filled(block.content.title) || filled(block.content.text);
    case "team": return filled(block.content.title) || filled(block.content.intro) || block.content.items.length > 0;
    case "logos": return filled(block.content.title) || block.content.items.length > 0;
    case "areas": return filled(block.content.title) || filled(block.content.intro);
    case "talent_cta": return filled(block.content.title) || filled(block.content.text);
    default: return block.content.items.length > 0;
  }
}

/** [no items yet, items that aren't complete enough to show]. */
const ITEMS_COPY: Partial<Record<SiteBlockV2["type"], readonly [string, string]>> = {
  values: ["Agrega valores para mostrarlos aquí.", "Escribe el título de cada valor para mostrarlo aquí."],
  benefits: ["Agrega beneficios para mostrarlos aquí.", "Escribe el título de cada beneficio para mostrarlo aquí."],
  stats: ["Agrega cifras para mostrarlas aquí.", "Escribe el valor y la etiqueta de cada cifra para mostrarla aquí."],
  process: ["Agrega los pasos de tu proceso para mostrarlos aquí.", "Escribe el título de cada paso para mostrarlo aquí."],
  gallery: ["Agrega fotos para mostrarlas aquí.", "Sube la foto y escribe su texto alternativo para mostrarla aquí."],
  testimonials: ["Agrega testimonios para mostrarlos aquí.", "Escribe el testimonio y el nombre, y confirma el permiso para mostrarlo aquí."],
  offices: ["Agrega oficinas para mostrarlas aquí.", "Escribe el nombre de cada oficina para mostrarla aquí."],
  faq: ["Agrega preguntas frecuentes para mostrarlas aquí.", "Escribe la pregunta y su respuesta para mostrarla aquí."],
  team: ["Agrega personas para mostrarlas aquí.", "Escribe el nombre y confirma el permiso de cada persona para mostrarla aquí."],
  logos: ["Agrega logos para mostrarlos aquí.", "Escribe el nombre y sube el logo para mostrarlo aquí."],
};
const AREAS_COPY = "Las áreas aparecen aquí cuando tengas vacantes publicadas con un área profesional.";
function slotCopy(block: SiteBlockV2, kind: "items" | "title"): string {
  if (kind === "title") return block.type === "hero" ? "Escribe el título principal de tu portada." : "Escribe un título para mostrar esta sección.";
  if (block.type === "story") return "Escribe tu historia para mostrarla aquí.";
  if (block.type === "video") return "Pega el enlace de YouTube o Vimeo para mostrar el video aquí.";
  if (block.type === "areas") return AREAS_COPY;
  const copy = ITEMS_COPY[block.type];
  const items = "items" in block.content ? block.content.items.length : 0;
  return copy ? copy[items > 0 ? 1 : 0] : "Completa esta sección para mostrarla aquí.";
}

/** The dashed editor slot, in the editor's own ink so it never reads as company content. */
function Slot({ kind, titleId, className }: { kind: "items" | "title"; titleId?: string; className?: string }) {
  const context = useEditorPlaceholder()!;
  const Icon = context.icon;
  // Areas come from published vacancies: there is nothing to fill in the editor.
  const action = context.onComplete && !(kind === "items" && context.block.type === "areas");
  return <div data-editor-placeholder={kind} className={cn("flex min-w-0 flex-col items-center justify-center gap-3 rounded-3xl border-2 border-dashed border-[color-mix(in_srgb,var(--editor-primary)_45%,transparent)] bg-(--card) px-6 py-8 text-center font-sans text-(--card-foreground)", className)}>
    <span aria-hidden="true" className="inline-flex size-10 items-center justify-center rounded-2xl bg-[color-mix(in_srgb,var(--editor-primary)_12%,transparent)] text-(--editor-primary)"><Icon className="size-5" /></span>
    <p id={titleId} className="max-w-prose text-sm font-medium text-pretty">{slotCopy(context.block, kind)}</p>
    {action && <Button type="button" data-editor-complete="" className="min-h-10 bg-(--editor-primary) text-(--editor-primary-foreground) hover:bg-[color-mix(in_srgb,var(--editor-primary)_88%,black)]" onClick={context.onComplete}>Completar sección</Button>}
  </div>;
}
/** Where the section's items (or its story text / video) go. */
export function ItemsSlot({ empty, className, children }: { empty: boolean; className?: string; children?: ReactNode }) {
  const context = useEditorPlaceholder();
  return context && empty ? <Slot kind="items" className={className} /> : <>{children}</>;
}
/** A required title (Portada, Cierre, Llamado a talento): the slot takes the title's id, so the section stays named. */
export function TitleSlot({ empty, id, className, children }: { empty: boolean; id: string; className?: string; children: ReactNode }) {
  const context = useEditorPlaceholder();
  return context && empty ? <Slot kind="title" titleId={id} className={className} /> : <>{children}</>;
}
