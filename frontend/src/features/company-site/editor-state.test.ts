import { describe, expect, it } from "vitest";
import { defaultBlock, defaultSiteDraft } from "./defaults";
import { createEditorState, editorReducer, addBlockAction, duplicateBlockAction, mapFieldErrors } from "./editor-state";
import { canPublish, RECRUITER_PUBLISH_REASON } from "./permissions";
import type { SiteState } from "./api/model";
export const serverState = (): SiteState => ({ draft: defaultSiteDraft(), draft_version: 1, published: null, has_unpublished_changes: false, media: [], updated_at: "2026-10-27T00:00:00Z" });
describe("editor reducer", () => {
  it("loads the server snapshot, version and ETag without dirtying selection", () => {
    const state = createEditorState(serverState(), '"1"');
    expect(state.dirty).toBe(false); expect(state.draft_version).toBe(1);
    expect(editorReducer(state, { type: "select", id: state.draft.blocks[0].id }).dirty).toBe(false);
  });
  it.each(["hero", "jobs"] as const)("never deletes, hides, adds or duplicates required %s", type => {
    const state = createEditorState(serverState(), '"1"'); const id = state.draft.blocks.find(b => b.type === type)!.id;
    for (const action of [{ type: "delete", id }, { type: "hidden", id, hidden: true }, addBlockAction(type), duplicateBlockAction(state, id)] as const) expect(editorReducer(state, action)).toEqual(state);
  });
  it("inserts after selection, otherwise before closing, otherwise at end", () => {
    let state = createEditorState(serverState(), '"1"');
    state = editorReducer(state, addBlockAction("closing"));
    state = editorReducer(state, { type: "select", id: null });
    state = editorReducer(state, addBlockAction("faq"));
    expect(state.draft.blocks.map(b => b.type)).toEqual(["hero", "jobs", "faq", "closing"]);
    state = editorReducer(state, { type: "select", id: state.draft.blocks[0].id });
    state = editorReducer(state, addBlockAction("story"));
    expect(state.draft.blocks[1].type).toBe("story"); expect(state.dirty).toBe(true);
  });
  it("duplicates with a fresh id and independent content", () => {
    let state = editorReducer(createEditorState(serverState(), '"1"'), addBlockAction("faq"));
    const block = state.draft.blocks[2]; state = editorReducer(state, duplicateBlockAction(state, block.id));
    expect(state.draft.blocks[3]).toEqual({ ...block, id: expect.any(String) });
    expect(state.draft.blocks[3].id).not.toBe(block.id); expect(state.draft.blocks[3].content).not.toBe(block.content);
  });
  it("respects move bounds and moves required blocks", () => {
    const state = createEditorState(serverState(), '"1"'); const id = state.draft.blocks[0].id;
    expect(editorReducer(state, { type: "move", id, direction: -1 })).toEqual(state);
    const moved = editorReducer(state, { type: "move", id, direction: 1 });
    expect(moved.draft.blocks[1].id).toBe(id); expect(editorReducer(moved, { type: "move", id, direction: 1 })).toEqual(moved);
  });
  it("edits content, variants, visibility, theme, SEO and slug; undoing edits clears dirty", () => {
    let state = createEditorState(serverState(), '"1"'); const original = state.draft; const id = original.blocks[0].id;
    state = editorReducer(state, { type: "content", id, content: { title: "Hola", subtitle: null, cover: null } });
    state = editorReducer(state, { type: "variant", id, variant: "centered" });
    expect(state.draft.blocks[0]).toMatchObject({ variant: "centered", content: { title: "Hola" } });
    expect(editorReducer(state, { type: "variant", id, variant: "mosaic" })).toEqual(state);
    state = editorReducer(state, { type: "theme", theme: { ...original.theme, brand_color: "#000000" } });
    state = editorReducer(state, { type: "seo", seo: { title: "Trabajo", description: null } });
    state = editorReducer(state, { type: "slug", slug: "nexo-labs" }); expect(state.draft.slug).toBe("nexo-labs");
    state = editorReducer(state, { type: "load", data: { ...serverState(), draft: original }, etag: '"1"' }); expect(state.dirty).toBe(false);
    state = editorReducer(state, addBlockAction("faq")); const faq = state.draft.blocks[2];
    state = editorReducer(state, { type: "hidden", id: faq.id, hidden: true }); expect(state.draft.blocks[2].hidden).toBe(true);
    state = editorReducer(state, { type: "delete", id: faq.id }); expect(state.dirty).toBe(false);
  });
  it("maps submitted block indices to stable ids, including nested fields", () => {
    const draft = defaultSiteDraft(); draft.blocks.push(defaultBlock("faq"));
    expect(mapFieldErrors([{ field: "blocks[2].content.items[0].question", code: "too_long" }, { field: "slug", code: "invalid" }], draft)).toEqual([
      { field: "content.items[0].question", code: "too_long", blockId: draft.blocks[2].id }, { field: "slug", code: "invalid" },
    ]);
  });
  it("caps the block library at 30", () => {
    let state = createEditorState(serverState(), '"1"'); for (let i = 0; i < 28; i++) state = editorReducer(state, addBlockAction("faq"));
    expect(editorReducer(state, addBlockAction("faq"))).toEqual(state);
  });
});
it("only owner publishes and recruiter gets the agreed explanation", () => {
  expect(canPublish("owner")).toBe(true); for (const role of ["recruiter", "admin", "", null]) expect(canPublish(role)).toBe(false);
  expect(RECRUITER_PUBLISH_REASON).toBe("Solo la persona dueña de la empresa puede publicar. Tus cambios quedan guardados en el borrador.");
});
