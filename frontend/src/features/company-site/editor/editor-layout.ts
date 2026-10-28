import type { Layout } from "react-resizable-panels";

export const EDITOR_LAYOUT_KEY = "peopleflow.careers-editor.layout.v2";
export const EDITOR_PANEL_SIZES = {
  sections: { default: "16rem", min: "14rem", max: "24rem" },
  properties: { default: "21rem", min: "18rem", max: "32rem" },
  preview: { min: "28rem" },
} as const;
/** First-load geometry only. Saved layouts keep their existing semantics.
 * Reserve the preview minimum, giving up properties width before sections. */
export function defaultEditorLayout(width: number, rem: number): Layout {
  const pixels = (size: string) => parseFloat(size) * rem;
  const sizes = EDITOR_PANEL_SIZES;
  const deficit = Math.max(0, pixels(sizes.sections.default) + pixels(sizes.properties.default) + pixels(sizes.preview.min) - width);
  const rightReduction = Math.min(deficit, pixels(sizes.properties.default) - pixels(sizes.properties.min));
  const properties = pixels(sizes.properties.default) - rightReduction;
  const sections = Math.max(pixels(sizes.sections.min), pixels(sizes.sections.default) - (deficit - rightReduction));
  return { sections: sections / width * 100, preview: Math.max(0, width - sections - properties) / width * 100, properties: properties / width * 100 };
}
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
