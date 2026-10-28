import { blockSchema, type BlockType, type SiteBlock, type SiteDraft } from "./model";
import { defaultBlock } from "./defaults";
import type { FieldError, SiteState } from "./api/model";

export type MappedFieldError = FieldError & { blockId?: string };
export type EditorState = {
  draft: SiteDraft; selectedId: string | null; dirty: boolean; draft_version: number; etag: string;
  lastSaved: SiteDraft; server: SiteState; fieldErrors: MappedFieldError[];
};
export type EditorAction =
  | { type: "load"; data: SiteState; etag: string }
  | { type: "saved"; data: SiteState; etag: string; submitted: SiteDraft }
  | { type: "invalid"; fields: FieldError[]; submitted: SiteDraft }
  | { type: "select"; id: string | null }
  | { type: "add"; block: SiteBlock }
  | { type: "duplicate"; id: string; newId: string }
  | { type: "delete"; id: string }
  | { type: "hidden"; id: string; hidden: boolean }
  | { type: "move"; id: string; direction: -1 | 1 }
  | { type: "content"; id: string; content: SiteBlock["content"] }
  | { type: "variant"; id: string; variant: string }
  | { type: "theme"; theme: SiteDraft["theme"] }
  | { type: "seo"; seo: SiteDraft["seo"] }
  | { type: "slug"; slug: string | null };

export const sameDraft = (a: SiteDraft, b: SiteDraft) => JSON.stringify(a) === JSON.stringify(b);
const required = (block: SiteBlock) => block.type === "hero" || block.type === "jobs";
/** Generate identities before dispatch: replaying the reducer is deterministic. */
export const addBlockAction = (type: BlockType): EditorAction => ({ type: "add", block: defaultBlock(type) });
export const duplicateBlockAction = (_state: EditorState, id: string): EditorAction => ({ type: "duplicate", id, newId: crypto.randomUUID() });
export function createEditorState(data: SiteState, etag: string): EditorState {
  const server = structuredClone(data);
  return { draft: structuredClone(data.draft), selectedId: null, dirty: false, draft_version: data.draft_version, etag, lastSaved: structuredClone(data.draft), server, fieldErrors: [] };
}
export function mapFieldErrors(fields: FieldError[], submitted: SiteDraft): MappedFieldError[] {
  return fields.map(error => {
    const match = /^blocks\[(\d+)\](?:\.(.*))?$/.exec(error.field);
    const blockId = match && submitted.blocks[Number(match[1])]?.id;
    return blockId ? { ...error, field: match[2] ?? "", blockId } : { ...error };
  });
}
function changed(state: EditorState, draft: SiteDraft): EditorState {
  return sameDraft(state.draft, draft) ? state : { ...state, draft, dirty: !sameDraft(draft, state.lastSaved), fieldErrors: [] };
}
export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case "load": return createEditorState(action.data, action.etag);
    case "saved": {
      // A canonical response replaces only the submitted draft, never newer keystrokes.
      const draft = sameDraft(state.draft, action.submitted) ? structuredClone(action.data.draft) : state.draft;
      return { ...state, draft, server: structuredClone(action.data), lastSaved: structuredClone(action.data.draft), draft_version: action.data.draft_version, etag: action.etag, dirty: !sameDraft(draft, action.data.draft), fieldErrors: [] };
    }
    case "invalid": return { ...state, fieldErrors: mapFieldErrors(action.fields, action.submitted) };
    case "select": return { ...state, selectedId: action.id !== null && state.draft.blocks.some(b => b.id === action.id) ? action.id : null };
    case "slug": return changed(state, { ...state.draft, slug: action.slug });
    case "theme": return changed(state, { ...state.draft, theme: structuredClone(action.theme) });
    case "seo": return changed(state, { ...state.draft, seo: structuredClone(action.seo) });
    case "add": {
      if (required(action.block) || state.draft.blocks.length >= 30 || state.draft.blocks.some(b => b.id === action.block.id)) return state;
      const blocks = [...state.draft.blocks];
      // After selection; otherwise at the end before closing, otherwise at the end.
      const selected = blocks.findIndex(b => b.id === state.selectedId);
      const closing = blocks.findIndex(b => b.type === "closing");
      blocks.splice(selected >= 0 ? selected + 1 : closing >= 0 ? closing : blocks.length, 0, structuredClone(action.block));
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
      blocks.splice(index, 1); break;
    case "hidden":
      if (required(block)) return state;
      blocks[index] = { ...block, hidden: action.hidden }; break;
    case "move": {
      const next = index + action.direction;
      if (next < 0 || next >= blocks.length) return state;
      [blocks[index], blocks[next]] = [blocks[next], blocks[index]]; break;
    }
    case "variant": {
      const schema = blockSchema.options.find(option => option.shape.type.value === block.type)!;
      if (!schema.shape.variant.safeParse(action.variant).success) return state;
      blocks[index] = { ...block, variant: action.variant } as SiteBlock; break;
    }
    case "content": blocks[index] = { ...block, content: structuredClone(action.content) } as SiteBlock; break;
  }
  const result = changed(state, { ...state.draft, blocks });
  // Stable block errors survive reordering; an actual edit clears obsolete errors.
  if (action.type === "move") result.fieldErrors = state.fieldErrors;
  if (action.type === "delete" && state.selectedId === action.id) return { ...result, selectedId: null };
  return result;
}
