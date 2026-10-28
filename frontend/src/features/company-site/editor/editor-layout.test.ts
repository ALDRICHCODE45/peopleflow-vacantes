import { afterEach, expect, it, vi } from "vitest";
import { defaultEditorLayout, EDITOR_PANEL_SIZES, readEditorLayout, saveEditorLayout, EDITOR_LAYOUT_KEY } from "./editor-layout";
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
