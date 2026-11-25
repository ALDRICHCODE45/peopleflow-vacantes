import { afterEach, describe, expect, it, vi } from "vitest";
import { arrangeSidePanels, defaultEditorLayout, EDITOR_PANEL_SIZES, EDITOR_PREVIEW_COMPACT_MIN, editorPanelMode, previewMinSize, readEditorLayout, saveEditorLayout, sidePanelLayout, EDITOR_LAYOUT_KEY } from "./editor-layout";
afterEach(() => { localStorage.clear(); vi.restoreAllMocks(); });
it("uses v2 storage and ignores legacy layouts", () => {
  expect(EDITOR_LAYOUT_KEY).toBe("peopleflow.careers-editor.layout.v2");
  for (const key of ["peopleflow.careers-editor.layout", "peopleflow.careers-editor.layout.v1"]) {
    localStorage.setItem(key, JSON.stringify({ v: 1, layout: { sections: 30, preview: 30, properties: 40 } }));
  }
  expect(readEditorLayout()).toBeUndefined();
});
it("sets balanced defaults and hard pane limits", () => {
  expect(EDITOR_PANEL_SIZES).toEqual({ sections: { default: "16rem", min: "14rem", max: "24rem" }, properties: { default: "21rem", min: "18rem", max: "32rem" }, preview: { min: "28rem" } });
});
it.each([[1200, 256, 608, 336], [1000, 256, 448, 296], [970, 234, 448, 288], [960, 224, 448, 288]])("prioritizes preview space at %ipx, shrinking right before left", (width, sections, preview, properties) => {
  const layout = defaultEditorLayout(width, 16);
  expect(layout.sections).toBeCloseTo(sections / width * 100);
  expect(layout.preview).toBeCloseTo(preview / width * 100);
  expect(layout.properties).toBeCloseTo(properties / width * 100);
});
it("round trips requested sizes and collapsed state", () => {
  const layout = { sections: 0, preview: 65, properties: 35 };
  saveEditorLayout(layout);
  expect(readEditorLayout()).toEqual(layout);
});
it.each(["{", '{"v":2,"layout":{}}', '{"v":1,"layout":{"sections":-1,"preview":50,"properties":51}}', '{"v":1,"layout":{"sections":0,"preview":0,"properties":100}}'])("ignores corrupt or incompatible preferences %s", raw => {
  localStorage.setItem(EDITOR_LAYOUT_KEY, raw);
  expect(readEditorLayout()).toBeUndefined();
});
it("tolerates denied browser storage", () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("Denied"); });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Denied"); });
  expect(readEditorLayout()).toBeUndefined();
  expect(() => saveEditorLayout({ sections: 20, preview: 50, properties: 30 })).not.toThrow();
});

describe("narrow desktops (L3: a side panel can always be shown again)", () => {
  const all = { sections: true, properties: true };
  it.each([[1440, "all"], [960, "all"], [959, "one-side"], [932, "one-side"], [676, "one-side"], [608, "one-side"], [607, "overlay"], [0, "all"]] as const)("at %ipx of panel space the panes run in %s mode", (width, mode) => {
    expect(editorPanelMode(width, 16)).toBe(mode);
  });
  it("lets the preview shrink to its compact minimum only when the three panes can't fit", () => {
    expect(EDITOR_PREVIEW_COMPACT_MIN).toBe("20rem");
    expect(previewMinSize("all")).toBe("28rem");
    expect(previewMinSize("one-side")).toBe("20rem");
  });
  it.each([[932, 256, 676], [676, 256, 420]])("first load at %ipx shows the section list (so «Agregar sección» is reachable) and folds properties", (width, sections, preview) => {
    const layout = defaultEditorLayout(width, 16);
    expect(layout.sections).toBeCloseTo(sections / width * 100);
    expect(layout.preview).toBeCloseTo(preview / width * 100);
    expect(layout.properties).toBe(0);
  });
  it("showing a side panel when the three can't fit folds the other one and remembers it", () => {
    const sectionsOnly = { shown: { sections: true, properties: false }, remembered: null };
    const shown = arrangeSidePanels("one-side", sectionsOnly, { type: "show", panel: "properties" });
    expect(shown).toEqual({ shown: { sections: false, properties: true }, remembered: "sections" });
    // Hiding it brings the remembered one back, so the editor never ends with both unreachable by accident.
    expect(arrangeSidePanels("one-side", shown, { type: "hide", panel: "properties" })).toEqual({ shown: { sections: true, properties: false }, remembered: null });
    // Hiding the remaining one leaves only the preview; either can be shown again.
    const none = arrangeSidePanels("one-side", { shown: { sections: true, properties: false }, remembered: null }, { type: "hide", panel: "sections" });
    expect(none).toEqual({ shown: { sections: false, properties: false }, remembered: null });
    expect(arrangeSidePanels("one-side", none, { type: "show", panel: "sections" }).shown).toEqual({ sections: true, properties: false });
  });
  it("keeps both panels independent when the three fit", () => {
    const state = { shown: { sections: true, properties: false }, remembered: null };
    expect(arrangeSidePanels("all", state, { type: "show", panel: "properties" })).toEqual({ shown: all, remembered: null });
    expect(arrangeSidePanels("all", { shown: all, remembered: null }, { type: "hide", panel: "sections" })).toEqual({ shown: { sections: false, properties: true }, remembered: null });
  });
  it("fits a wider layout into a narrower desktop and restores it when space comes back", () => {
    const narrowed = arrangeSidePanels("one-side", { shown: all, remembered: null }, { type: "fit" });
    expect(narrowed).toEqual({ shown: { sections: true, properties: false }, remembered: "properties" });
    expect(arrangeSidePanels("all", narrowed, { type: "fit" })).toEqual({ shown: all, remembered: null });
    const untouched = { shown: { sections: false, properties: true }, remembered: null };
    expect(arrangeSidePanels("one-side", untouched, { type: "fit" })).toBe(untouched);
  });
  it.each([
    [932, { sections: false, properties: true }, {}, [0, 596, 336]],
    [676, { sections: false, properties: true }, {}, [0, 340, 336]],
    [676, { sections: false, properties: true }, { properties: 512 }, [0, 320, 356]],
    [676, { sections: true, properties: false }, { sections: 384 }, [356, 320, 0]],
    [1200, all, { sections: 300, properties: 400 }, [300, 500, 400]],
    [1000, all, { sections: 300, properties: 400 }, [264, 448, 288]],
  ] as const)("sizes the shown panels at %ipx keeping the preview minimum", (width, shown, preferred, [sections, preview, properties]) => {
    const layout = sidePanelLayout(width, 16, shown, preferred);
    expect(layout.sections).toBeCloseTo(sections / width * 100);
    expect(layout.preview).toBeCloseTo(preview / width * 100);
    expect(layout.properties).toBeCloseTo(properties / width * 100);
    expect(layout.sections + layout.preview + layout.properties).toBeCloseTo(100);
  });
});
