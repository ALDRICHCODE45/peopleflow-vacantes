import type { Layout } from "react-resizable-panels";

export const EDITOR_LAYOUT_KEY = "peopleflow.careers-editor.layout";
/** Only geometry is stored, never site content. Zero encodes a collapsed pane. */
export function readEditorLayout(): Layout | undefined {
  try {
    const value = JSON.parse(localStorage.getItem(EDITOR_LAYOUT_KEY) ?? "null");
    const layout = value?.layout;
    if (value?.v !== 1 || !layout || !["sections", "preview", "properties"].every(id => typeof layout[id] === "number" && Number.isFinite(layout[id]) && layout[id] >= 0 && layout[id] <= 100) || layout.preview <= 0) return;
    if (Math.abs(layout.sections + layout.preview + layout.properties - 100) > 0.1) return;
    return { sections: layout.sections, preview: layout.preview, properties: layout.properties };
  } catch { return; }
}
export function saveEditorLayout(layout: Layout) {
  try { localStorage.setItem(EDITOR_LAYOUT_KEY, JSON.stringify({ v: 1, layout })); } catch { /* Storage may be disabled; resizing remains available. */ }
}
