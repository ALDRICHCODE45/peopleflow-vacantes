import type { Layout } from "react-resizable-panels";

export const EDITOR_LAYOUT_KEY = "peopleflow.careers-editor.layout.v2";
export const EDITOR_PANEL_SIZES = {
  sections: { default: "16rem", min: "14rem", max: "24rem" },
  properties: { default: "21rem", min: "18rem", max: "32rem" },
  preview: { min: "28rem" },
} as const;
/** Narrower than 28rem the preview is still usable while only one side panel is open. */
export const EDITOR_PREVIEW_COMPACT_MIN = "20rem";
export type SidePanel = "sections" | "properties";
export type SidePanels = Record<SidePanel, boolean>;
/** «all»: the three panes fit at their minimums and open independently. «one-side»: only one
 * side panel fits beside the preview, so showing one folds the other. «overlay»: not even one
 * fits; side panels open as Sheets like the phone layout. */
export type EditorPanelMode = "all" | "one-side" | "overlay";
const pixels = (size: string, rem: number) => parseFloat(size) * rem;
/** `width` is the space the three panes share (group width minus its separators). An unmeasured
 * width (0: server render, jsdom) keeps the regular three-pane layout. */
export function editorPanelMode(width: number, rem: number): EditorPanelMode {
  if (!(width > 0)) return "all";
  const sizes = EDITOR_PANEL_SIZES;
  if (width >= pixels(sizes.sections.min, rem) + pixels(sizes.preview.min, rem) + pixels(sizes.properties.min, rem)) return "all";
  if (width >= Math.max(pixels(sizes.sections.min, rem), pixels(sizes.properties.min, rem)) + pixels(EDITOR_PREVIEW_COMPACT_MIN, rem)) return "one-side";
  return "overlay";
}
export function previewMinSize(mode: EditorPanelMode) {
  return mode === "all" ? EDITOR_PANEL_SIZES.preview.min : EDITOR_PREVIEW_COMPACT_MIN;
}
/** Pixel sizes for the shown side panels (preferred or default, within their limits), giving
 * up properties width before sections so the preview keeps its minimum for this width. */
export function sidePanelLayout(width: number, rem: number, shown: SidePanels, preferred: Partial<Record<SidePanel, number>> = {}): Layout {
  const sizes = EDITOR_PANEL_SIZES;
  const previewMin = pixels(previewMinSize(editorPanelMode(width, rem)), rem);
  const size = (id: SidePanel) => shown[id] ? Math.min(pixels(sizes[id].max, rem), Math.max(pixels(sizes[id].min, rem), preferred[id] ?? pixels(sizes[id].default, rem))) : 0;
  let sections = size("sections");
  let properties = size("properties");
  let deficit = Math.max(0, sections + properties + previewMin - width);
  if (properties) { const cut = Math.min(deficit, properties - pixels(sizes.properties.min, rem)); properties -= cut; deficit -= cut; }
  if (sections) sections -= Math.min(deficit, sections - pixels(sizes.sections.min, rem));
  return { sections: sections / width * 100, preview: Math.max(0, width - sections - properties) / width * 100, properties: properties / width * 100 };
}
/** First-load geometry only. Saved layouts keep their existing semantics.
 * Reserve the preview minimum, giving up properties width before sections; when the three
 * can't fit, start with the section list (it owns «Agregar sección») and properties folded. */
export function defaultEditorLayout(width: number, rem: number): Layout {
  return sidePanelLayout(width, rem, { sections: true, properties: editorPanelMode(width, rem) === "all" });
}
export type SidePanelState = { shown: SidePanels; remembered: SidePanel | null };
export type SidePanelEvent = { type: "show" | "hide"; panel: SidePanel } | { type: "fit" };
const other = (panel: SidePanel): SidePanel => panel === "sections" ? "properties" : "sections";
/** Showing a side panel always works: when only one fits it folds the other and remembers it,
 * bringing it back when the shown one is hidden again or the space grows. */
export function arrangeSidePanels(mode: EditorPanelMode, state: SidePanelState, event: SidePanelEvent): SidePanelState {
  const { shown, remembered } = state;
  if (event.type === "fit") {
    if (mode === "one-side" && shown.sections && shown.properties) return { shown: { sections: true, properties: false }, remembered: "properties" };
    if (mode === "all" && remembered) return { shown: { ...shown, [remembered]: true }, remembered: null };
    return state;
  }
  const { panel } = event;
  if (event.type === "show") {
    if (mode !== "all" && shown[other(panel)]) return { shown: { ...shown, [panel]: true, [other(panel)]: false } as SidePanels, remembered: other(panel) };
    return { shown: { ...shown, [panel]: true }, remembered: remembered === panel ? null : remembered };
  }
  if (mode !== "all" && remembered && remembered !== panel) return { shown: { ...shown, [panel]: false, [remembered]: true } as SidePanels, remembered: null };
  return { shown: { ...shown, [panel]: false }, remembered: remembered === panel ? null : remembered };
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
