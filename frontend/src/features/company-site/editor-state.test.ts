import { describe, expect, it } from "vitest";
import { defaultBlockV2 as defaultBlock, defaultSiteDraft } from "./defaults";
import { v2Draft } from "./editor/site-state.test-support";
import { createEditorState, editorReducer, addBlockAction, duplicateBlockAction, mapFieldErrors, canReorder, type EditorState } from "./editor-state";
import { canPublish, RECRUITER_PUBLISH_REASON } from "./permissions";
import type { SiteState } from "./api/model";
export const serverState = (): SiteState => ({ draft: v2Draft(defaultSiteDraft()), draft_version: 1, published: null, has_unpublished_changes: false, media: [], updated_at: "2026-10-27T00:00:00Z" });
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
    const hero = original.blocks[0]; if (hero.type !== "hero") throw new Error("fixture");
    state = editorReducer(state, { type: "content", id, content: { ...hero.content, title: "Hola" } });
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
    const draft = v2Draft(defaultSiteDraft()); draft.blocks.push(defaultBlock("faq"));
    expect(mapFieldErrors([{ field: "blocks[2].content.items[0].question", code: "too_long" }, { field: "slug", code: "invalid" }], draft)).toEqual([
      { field: "content.items[0].question", code: "too_long", blockId: draft.blocks[2].id }, { field: "slug", code: "invalid" },
    ]);
  });
  describe("reorder", () => {
    // hero, story, faq, jobs, closing
    const setup = (): EditorState => {
      const data = serverState(); data.draft.blocks.splice(1, 0, defaultBlock("story"), defaultBlock("faq")); data.draft.blocks.push(defaultBlock("closing"));
      return createEditorState(data, '"1"');
    };
    const types = (state: EditorState) => state.draft.blocks.map(b => b.type);
    it("places the block at the requested final index in one change", () => {
      const state = setup(); const story = state.draft.blocks[1].id;
      const down = editorReducer(state, { type: "reorder", id: story, toIndex: 3 });
      expect(types(down)).toEqual(["hero", "faq", "jobs", "story", "closing"]); expect(down.dirty).toBe(true);
      const closing = state.draft.blocks[4].id;
      expect(types(editorReducer(state, { type: "reorder", id: closing, toIndex: 1 }))).toEqual(["hero", "closing", "story", "faq", "jobs"]);
    });
    it("is a no-op for the same index, out of range or an unknown id", () => {
      const state = setup(); const story = state.draft.blocks[1].id;
      for (const toIndex of [1, -1, 5]) expect(editorReducer(state, { type: "reorder", id: story, toIndex })).toBe(state);
      expect(editorReducer(state, { type: "reorder", id: "missing", toIndex: 0 })).toBe(state);
    });
    it("rejects moving Portada away from first, anything above it, or Vacantes above Portada", () => {
      const state = setup(); const [hero, story, , jobs] = state.draft.blocks.map(b => b.id);
      expect(editorReducer(state, { type: "reorder", id: hero, toIndex: 2 })).toBe(state);
      expect(editorReducer(state, { type: "reorder", id: story, toIndex: 0 })).toBe(state);
      expect(editorReducer(state, { type: "reorder", id: jobs, toIndex: 0 })).toBe(state);
      expect(canReorder(state.draft.blocks, story, 0)).toBe(false); expect(canReorder(state.draft.blocks, story, 2)).toBe(true);
      expect(canReorder(state.draft.blocks, jobs, 1)).toBe(true); expect(canReorder(state.draft.blocks, story, 1)).toBe(true);
    });
    it("keeps stable block field errors like move", () => {
      let state = setup(); const story = state.draft.blocks[1].id;
      state = editorReducer(state, { type: "invalid", fields: [{ field: "blocks[1].content.title", code: "too_long" }], submitted: state.draft });
      expect(editorReducer(state, { type: "reorder", id: story, toIndex: 2 }).fieldErrors).toEqual(state.fieldErrors);
    });
  });
  it("inserts a deleted block back at its index and selects it, never duplicating ids or required blocks", () => {
    const data = serverState(); const story = defaultBlock("story"); data.draft.blocks.splice(1, 0, story);
    const state = createEditorState(data, '"1"');
    const deleted = editorReducer(state, { type: "delete", id: story.id });
    const restored = editorReducer(deleted, { type: "insert", block: story, index: 1 });
    expect(restored.draft).toEqual(state.draft); expect(restored.selectedId).toBe(story.id); expect(restored.dirty).toBe(false);
    expect(editorReducer(restored, { type: "insert", block: story, index: 1 })).toBe(restored);
    expect(editorReducer(deleted, { type: "insert", block: defaultBlock("hero"), index: 1 })).toBe(deleted);
    expect(editorReducer(deleted, { type: "insert", block: story, index: 0 }).draft.blocks[0].type).toBe("hero");
  });
  it("restores a whole draft as an edit and applies a valid selection", () => {
    const state = createEditorState(serverState(), '"1"'); const id = state.draft.blocks[1].id;
    const edited = editorReducer(state, { type: "slug", slug: "otro" });
    const restored = editorReducer(edited, { type: "restore", draft: state.draft, selectedId: id });
    expect(restored.draft).toEqual(state.draft); expect(restored.dirty).toBe(false); expect(restored.selectedId).toBe(id);
    expect(editorReducer(edited, { type: "restore", draft: state.draft, selectedId: "gone" }).selectedId).toBeNull();
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
describe("sections v2 switched off (today's editor)", () => {
  it("ignores style edits and refuses slice A layouts", () => {
    const state = createEditorState(serverState(), '"1"'); const jobs = state.draft.blocks[1];
    expect(editorReducer(state, { type: "style", id: jobs.id, style: { ...jobs.style, background: "tint" } })).toBe(state);
    expect(editorReducer(state, { type: "variant", id: state.draft.blocks[0].id, variant: "collage" })).toBe(state);
    expect(editorReducer(state, addBlockAction("benefits", { variant: "bento" })).draft.blocks[2]).toMatchObject({ type: "benefits", variant: "grid" });
  });
  it("normalizes a legacy server draft to the v2 shape without dirtying it", () => {
    const state = createEditorState(serverState(), '"1"');
    expect(state.dirty).toBe(false);
    expect(state.draft.blocks[0]).toMatchObject({ style: { background: "default", spacing: "airy", align: "start", overlay: null, image: null }, content: { primary_label: "Ver vacantes", secondary_visible: true, secondary_target: null, images: [] } });
  });
  it("still clears a dangling Portada target on delete (any stored v2 document)", () => {
    const data = serverState(); const story = defaultBlock("story"); data.draft.blocks.splice(1, 0, story);
    const hero = data.draft.blocks[0]; if (hero.type !== "hero") throw new Error("fixture");
    hero.content.secondary_target = story.id;
    const deleted = editorReducer(createEditorState(data, '"1"'), { type: "delete", id: story.id });
    expect(deleted.draft.blocks[0]).toMatchObject({ content: { secondary_target: null } });
    const restored = editorReducer(deleted, { type: "insert", block: story, index: 1, heroTarget: true });
    expect(restored.draft.blocks[0]).toMatchObject({ content: { secondary_target: story.id } });
  });
});
