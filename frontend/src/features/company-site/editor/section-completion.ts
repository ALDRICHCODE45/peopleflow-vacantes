import { deriveDraftDescriptionPlain } from "@/features/jobs/drafts/rich/plain";
import { HERO_COLLAGE_MIN_TO_PUBLISH, type SiteBlockV2 } from "../model";
import type { PropertyGroupId } from "./property-groups";

/** Where a missing part is edited: the properties group, a `data-complete-target` in it and,
 * for a list item, its index (`data-item-index`). */
export type CompletionTarget = { group: PropertyGroupId; target: string; item?: number };
export type MissingContent = CompletionTarget & { hint: string };

const present = (value: string | null | undefined) => Boolean(value?.trim());
type Check = { key: string; label: string; ok: (item: never) => boolean };
type ListRule = { min: number; one: string; many: string; noun: string; checks: Check[] };
const check = <T>(key: string, label: string, ok: (item: T) => boolean): Check => ({ key, label, ok: ok as (item: never) => boolean });
/** The same per-item rules as the publish check (model.ts `complete`), in field order. */
const LISTS: Partial<Record<SiteBlockV2["type"], ListRule>> = {
  values: { min: 1, one: "valor", many: "valores", noun: "valor", checks: [check<{ title: string | null }>("title", "el título", item => present(item.title))] },
  benefits: { min: 1, one: "beneficio", many: "beneficios", noun: "beneficio", checks: [check<{ title: string | null }>("title", "el título", item => present(item.title))] },
  stats: { min: 1, one: "cifra", many: "cifras", noun: "cifra", checks: [check<{ value: string | null }>("value", "el valor", item => present(item.value)), check<{ label: string | null }>("label", "la etiqueta", item => present(item.label))] },
  process: { min: 2, one: "paso", many: "pasos", noun: "paso", checks: [check<{ title: string | null }>("title", "el título", item => present(item.title))] },
  gallery: { min: 2, one: "foto con texto alternativo", many: "fotos con texto alternativo", noun: "foto", checks: [check<{ image: unknown }>("image", "la imagen", item => item.image !== null), check<{ alt: string | null }>("alt", "el texto alternativo", item => present(item.alt))] },
  testimonials: { min: 1, one: "testimonio con permiso", many: "testimonios con permiso", noun: "testimonio", checks: [check<{ quote: string | null }>("quote", "el testimonio", item => present(item.quote)), check<{ name: string | null }>("name", "el nombre", item => present(item.name)), check<{ consent: boolean }>("consent", "el permiso", item => item.consent === true)] },
  offices: { min: 1, one: "oficina", many: "oficinas", noun: "oficina", checks: [check<{ name: string | null }>("name", "el nombre", item => present(item.name)), check<{ location: { country?: string } | null }>("location", "el país", item => present(item.location?.country))] },
  faq: { min: 1, one: "pregunta", many: "preguntas", noun: "elemento", checks: [check<{ question: string | null }>("question", "la pregunta", item => present(item.question)), check<{ answer: string | null }>("answer", "la respuesta", item => present(item.answer))] },
  team: { min: 1, one: "persona con permiso", many: "personas con permiso", noun: "persona", checks: [check<{ name: string | null }>("name", "el nombre", item => present(item.name)), check<{ consent: boolean }>("consent", "el permiso", item => item.consent === true)] },
  logos: { min: 1, one: "logo con imagen", many: "logos con imagen", noun: "logo", checks: [check<{ name: string | null }>("name", "el nombre", item => present(item.name)), check<{ image: unknown }>("image", "el logo", item => item.image !== null)] },
};

function missingContentPart(block: SiteBlockV2, blocks: readonly SiteBlockV2[]): MissingContent | null {
  const content = (target: string, hint: string): MissingContent => ({ hint, group: "content", target });
  switch (block.type) {
    case "hero": {
      if (!present(block.content.title)) return content("title", "Falta: el título principal");
      if (block.variant === "background_loop") return { hint: "Falta: el video de fondo, que llega pronto; elige otro diseño", group: "layout", target: "variants" };
      if (block.variant === "collage" && block.content.images.length < HERO_COLLAGE_MIN_TO_PUBLISH) return content("collage", `Falta: al menos ${HERO_COLLAGE_MIN_TO_PUBLISH} fotos para el collage`);
      const target = block.content.secondary_target;
      if (block.content.secondary_visible && target !== null && blocks.find(item => item.id === target)?.hidden) return { hint: "Falta: el botón secundario lleva a una sección oculta", group: "buttons", target: "secondary-target" };
      return null;
    }
    case "jobs": return null;
    case "story": return present(deriveDraftDescriptionPlain(block.content.body)) ? null : content("story-body", "Falta: el texto de la historia");
    case "video": return block.content.video ? null : content("video", "Falta: el enlace del video");
    case "closing": case "areas": case "talent_cta": return present(block.content.title) ? null : content("title", "Falta: el título");
    default: {
      const rule = LISTS[block.type]!;
      const items = block.content.items as never[];
      for (const [index, item] of items.entries()) {
        const failed = rule.checks.find(entry => !entry.ok(item));
        if (failed) return { hint: `Falta: ${failed.label} (${rule.noun} ${index + 1})`, group: "content", target: `item:${failed.key}`, item: index };
      }
      if (items.length < rule.min) return content("items-add", `Falta: al menos ${rule.min} ${rule.min === 1 ? rule.one : rule.many}`);
      return null;
    }
  }
}
/** The first thing a visible section still needs to be published (same rules and order as
 * `publishIssuesV2`), or null. Hidden sections never block publication. */
export function missingContent(block: SiteBlockV2, blocks: readonly SiteBlockV2[] = []): MissingContent | null {
  if (block.hidden) return null;
  const part = missingContentPart(block, blocks);
  if (part) return part;
  if (block.style.background === "image" && block.style.image === null) return { hint: "Falta: la imagen de fondo", group: "style", target: "style-image" };
  return null;
}

const FOCUSABLE = 'input:not([type="hidden"]):not([type="file"]):not([disabled]), textarea:not([disabled]), [contenteditable="true"], button:not([disabled]), [role="switch"], [tabindex]:not([tabindex="-1"])';
/** Focus the control for `target` inside the properties `root`; false while it isn't rendered or shown yet. */
export function focusCompletion(root: HTMLElement, target: CompletionTarget | null): boolean {
  const group = root.querySelector<HTMLElement>(`[data-property-group="${target?.group ?? "content"}"]`) ?? root;
  const scope = target?.item === undefined ? group : group.querySelector<HTMLElement>(`[data-item-index="${target.item}"]`);
  const holder = target ? scope?.querySelector<HTMLElement>(`[data-complete-target="${target.target}"]`) : group;
  const control = holder?.matches(FOCUSABLE) ? holder : holder?.querySelector<HTMLElement>(FOCUSABLE);
  if (!control) return false;
  control.focus();
  // Focusing scrolls the panel's own scroll area to the control.
  return control.ownerDocument?.activeElement === control;
}
