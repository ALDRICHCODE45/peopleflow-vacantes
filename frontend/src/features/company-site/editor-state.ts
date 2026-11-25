import { blockSchema, blockSchemaV2, sectionStyleSchema, siteDraftReadSchemaV2, type BlockTypeV2, type SectionStyle, type SiteBlockV2, type SiteDraftV2 } from "./model";
import { defaultBlockV2 } from "./defaults";
import { SECTIONS_V2_ENABLED } from "./sections-v2";
import type { FieldError, SiteState } from "./api/model";

export type MappedFieldError = FieldError & { blockId?: string };
/** The editor always works on the sections v2 document; with the flag off it only
 * ever holds slice A defaults, and the PUT gate emits today's v1 body. */
export type EditorState = {
  draft: SiteDraftV2; selectedId: string | null; dirty: boolean; draft_version: number; etag: string;
  lastSaved: SiteDraftV2; server: SiteState; fieldErrors: MappedFieldError[];
};
export type EditorAction =
  | { type: "load"; data: SiteState; etag: string }
  | { type: "saved"; data: SiteState; etag: string; submitted: SiteDraftV2 }
  | { type: "invalid"; fields: FieldError[]; submitted: SiteDraftV2 }
  | { type: "select"; id: string | null }
  /** Without `index`: after the selection, else before Cierre, else at the end. */
  | { type: "add"; block: SiteBlockV2; index?: number }
  | { type: "duplicate"; id: string; newId: string }
  /** Also clears the Portada secondary button target when it pointed at this block. */
  | { type: "delete"; id: string }
  | { type: "hidden"; id: string; hidden: boolean }
  | { type: "move"; id: string; direction: -1 | 1 }
  /** Place a block at its final index. One dispatch is one undo step. */
  | { type: "reorder"; id: string; toIndex: number }
  /** Put a removed block back at its index (undo after delete) and select it;
   * `heroTarget` points the Portada secondary button at it again. */
  | { type: "insert"; block: SiteBlockV2; index: number; heroTarget?: boolean }
  /** Replace the whole draft (undo/redo); selection is not part of the history. */
  | { type: "restore"; draft: SiteDraftV2; selectedId: string | null }
  | { type: "content"; id: string; content: SiteBlockV2["content"] }
  | { type: "variant"; id: string; variant: string }
  /** «Estilo de sección» (sections v2 only). */
  | { type: "style"; id: string; style: SectionStyle }
  | { type: "theme"; theme: SiteDraftV2["theme"] }
  | { type: "seo"; seo: SiteDraftV2["seo"] }
  | { type: "slug"; slug: string | null };

export const sameDraft = (a: SiteDraftV2, b: SiteDraftV2) => JSON.stringify(a) === JSON.stringify(b);
const required = (block: SiteBlockV2) => block.type === "hero" || block.type === "jobs";
/** Normalizes any stored document (legacy included) to the v2 shape the editor holds. */
export function readDraft(draft: unknown): SiteDraftV2 {
  const parsed = siteDraftReadSchemaV2.safeParse(draft);
  return parsed.success ? parsed.data : structuredClone(draft as SiteDraftV2);
}
/** Generate identities before dispatch: replaying the reducer is deterministic.
 * `variant` (library) starts the block in a chosen layout; `index` places it. */
export const addBlockAction = (type: BlockTypeV2, options: { variant?: string; index?: number } = {}): EditorAction => {
  const block = defaultBlockV2(type);
  const variant = options.variant && variantAllowed(block.type, options.variant) ? options.variant : block.variant;
  return { type: "add", block: { ...block, variant } as SiteBlockV2, ...(options.index === undefined ? {} : { index: options.index }) };
};
export const duplicateBlockAction = (_state: EditorState, id: string): EditorAction => ({ type: "duplicate", id, newId: crypto.randomUUID() });
/** Layouts the editor may set: today's with sections v2 off, every slice A layout with it on. */
export function variantOptions(type: BlockTypeV2): readonly string[] {
  const legacy = blockSchema.options.find(option => option.shape.type.value === type);
  if (!SECTIONS_V2_ENABLED) return legacy ? legacy.shape.variant.options : [];
  return blockSchemaV2.options.find(option => option.shape.type.value === type)!.shape.variant.options;
}
const variantAllowed = (type: BlockTypeV2, variant: string) => variantOptions(type).includes(variant);
type Placeable = { id: string; type: string };
export const PORTADA_FIRST = "Portada siempre va primero.";
/** The one placement rule (reducer, list drag, Subir/Bajar, Alt+arrows): Portada
 * (hero) never moves down. So it stays first, nothing (Vacantes included) can land
 * above it, and a legacy order with Portada lower may only improve. Returns the
 * reason a move is refused, or null when it is allowed or isn't a move at all. */
export function placementError(blocks: readonly Placeable[], id: string, toIndex: number): string | null {
  const from = blocks.findIndex(b => b.id === id);
  if (from < 0 || from === toIndex || !Number.isInteger(toIndex) || toIndex < 0 || toIndex >= blocks.length) return null;
  const hero = blocks.findIndex(b => b.type === "hero");
  if (hero < 0) return null;
  const heroAfter = from === hero ? toIndex : from > hero && toIndex <= hero ? hero + 1 : from < hero && toIndex >= hero ? hero - 1 : hero;
  return heroAfter > hero ? PORTADA_FIRST : null;
}
/** True for an in-range index the placement rule allows (the current index included). */
export function canReorder(blocks: readonly Placeable[], id: string, toIndex: number): boolean {
  const from = blocks.findIndex(b => b.id === id);
  if (from < 0 || !Number.isInteger(toIndex) || toIndex < 0 || toIndex >= blocks.length) return false;
  return placementError(blocks, id, toIndex) === null;
}
/** Where a block added without an explicit index lands (shared with the library default). */
export function defaultInsertIndex(blocks: readonly Placeable[], selectedId: string | null): number {
  const selected = blocks.findIndex(b => b.id === selectedId);
  const closing = blocks.findIndex(b => b.type === "closing");
  return selected >= 0 ? selected + 1 : closing >= 0 ? closing : blocks.length;
}
export function createEditorState(data: SiteState, etag: string): EditorState {
  const server = structuredClone(data);
  const draft = readDraft(data.draft);
  return { draft, selectedId: null, dirty: false, draft_version: data.draft_version, etag, lastSaved: structuredClone(draft), server, fieldErrors: [] };
}
export function mapFieldErrors(fields: FieldError[], submitted: { blocks: readonly { id: string }[] }): MappedFieldError[] {
  return fields.map(error => {
    const match = /^blocks\[(\d+)\](?:\.(.*))?$/.exec(error.field);
    const blockId = match && submitted.blocks[Number(match[1])]?.id;
    return blockId ? { ...error, field: match[2] ?? "", blockId } : { ...error };
  });
}
function changed(state: EditorState, draft: SiteDraftV2): EditorState {
  return sameDraft(state.draft, draft) ? state : { ...state, draft, dirty: !sameDraft(draft, state.lastSaved), fieldErrors: [] };
}
/** Curated combinations only: overlay and image belong to an image background, which starts at a medium veil. */
function normalizeStyle(style: SectionStyle): SectionStyle | null {
  const next: SectionStyle = style.background === "image" ? { ...style, overlay: style.overlay ?? "medium" } : { ...style, overlay: null, image: null };
  const parsed = sectionStyleSchema.safeParse(next);
  return parsed.success ? parsed.data : null;
}
/** A Portada whose secondary button targets `id` (index into blocks), or -1. */
const heroTargeting = (blocks: readonly SiteBlockV2[], id: string) => blocks.findIndex(block => block.type === "hero" && block.content.secondary_target === id);
function retargetHero(blocks: SiteBlockV2[], target: string | null, from: string | null) {
  const index = from === null ? blocks.findIndex(block => block.type === "hero") : heroTargeting(blocks, from);
  const hero = blocks[index];
  if (hero?.type === "hero") blocks[index] = { ...hero, content: { ...hero.content, secondary_target: target } };
}
export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case "load": return createEditorState(action.data, action.etag);
    case "saved": {
      // A canonical response replaces only the submitted draft, never newer keystrokes.
      const saved = readDraft(action.data.draft);
      const draft = sameDraft(state.draft, action.submitted) ? structuredClone(saved) : state.draft;
      return { ...state, draft, server: structuredClone(action.data), lastSaved: saved, draft_version: action.data.draft_version, etag: action.etag, dirty: !sameDraft(draft, saved), fieldErrors: [] };
    }
    case "invalid": return { ...state, fieldErrors: mapFieldErrors(action.fields, action.submitted) };
    case "select": return { ...state, selectedId: action.id !== null && state.draft.blocks.some(b => b.id === action.id) ? action.id : null };
    case "restore": {
      const draft = structuredClone(action.draft);
      const selectedId = action.selectedId !== null && draft.blocks.some(b => b.id === action.selectedId) ? action.selectedId : null;
      return { ...changed(state, draft), selectedId };
    }
    case "slug": return changed(state, { ...state.draft, slug: action.slug });
    case "theme": return changed(state, { ...state.draft, theme: structuredClone(action.theme) });
    case "seo": return changed(state, { ...state.draft, seo: structuredClone(action.seo) });
    case "add": {
      if (required(action.block) || state.draft.blocks.length >= 30 || state.draft.blocks.some(b => b.id === action.block.id)) return state;
      const blocks = [...state.draft.blocks];
      const min = blocks[0]?.type === "hero" ? 1 : 0;
      const index = action.index === undefined ? defaultInsertIndex(blocks, state.selectedId) : Number.isInteger(action.index) ? Math.min(Math.max(action.index, min), blocks.length) : null;
      if (index === null) return state;
      blocks.splice(index, 0, structuredClone(action.block));
      return { ...changed(state, { ...state.draft, blocks }), selectedId: action.block.id };
    }
    case "insert": {
      const blocks = [...state.draft.blocks];
      if (required(action.block) || blocks.length >= 30 || blocks.some(b => b.id === action.block.id)) return state;
      const min = blocks[0]?.type === "hero" ? 1 : 0;
      blocks.splice(Math.min(Math.max(action.index, min), blocks.length), 0, structuredClone(action.block));
      if (action.heroTarget) retargetHero(blocks, action.block.id, null);
      return { ...changed(state, { ...state.draft, blocks }), selectedId: action.block.id };
    }
  }
  const index = state.draft.blocks.findIndex(b => b.id === action.id);
  if (index < 0) return state;
  const block = state.draft.blocks[index]; const blocks = [...state.draft.blocks];
  switch (action.type) {
    case "duplicate":
      if (required(block) || blocks.length >= 30 || blocks.some(b => b.id === action.newId)) return state;
      blocks.splice(index + 1, 0, { ...structuredClone(block), id: action.newId }); break;
    case "delete":
      if (required(block)) return state;
      blocks.splice(index, 1);
      // Same step: a dangling target would be refused by the save gate.
      retargetHero(blocks, null, action.id); break;
    case "hidden":
      if (required(block)) return state;
      blocks[index] = { ...block, hidden: action.hidden }; break;
    case "reorder":
      if (action.toIndex === index || !canReorder(blocks, action.id, action.toIndex)) return state;
      blocks.splice(index, 1); blocks.splice(action.toIndex, 0, block); break;
    // Low-level swap without the placement rule; the UI moves through "reorder".
    case "move": {
      const next = index + action.direction;
      if (next < 0 || next >= blocks.length) return state;
      [blocks[index], blocks[next]] = [blocks[next], blocks[index]]; break;
    }
    case "variant":
      if (!variantAllowed(block.type, action.variant)) return state;
      blocks[index] = { ...block, variant: action.variant } as SiteBlockV2; break;
    case "style": {
      if (!SECTIONS_V2_ENABLED) return state;
      const style = normalizeStyle(action.style);
      if (!style) return state;
      blocks[index] = { ...block, style }; break;
    }
    case "content": blocks[index] = { ...block, content: structuredClone(action.content) } as SiteBlockV2; break;
  }
  const result = changed(state, { ...state.draft, blocks });
  // Stable block errors survive reordering; an actual edit clears obsolete errors.
  if (action.type === "move" || action.type === "reorder") result.fieldErrors = state.fieldErrors;
  if (action.type === "delete" && state.selectedId === action.id) return { ...result, selectedId: null };
  return result;
}
