import { afterEach, expect, it, vi } from "vitest";
import { readEditorLayout, saveEditorLayout, EDITOR_LAYOUT_KEY } from "./editor-layout";
afterEach(() => { localStorage.clear(); vi.restoreAllMocks(); });
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
