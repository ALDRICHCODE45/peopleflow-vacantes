"use client";

import { useLayoutEffect, useState, type RefObject } from "react";
import { editorPanelMode, type EditorPanelMode } from "./editor-layout";

/** The two 1 px resize handles between the three panes. */
const SEPARATORS_PX = 2;
/** Which side panels fit beside the preview in the editor workspace (L3). The workspace stays
 * mounted in every mode, so it can be measured even while the panels open as Sheets. */
export function useEditorPanelMode(ref: RefObject<HTMLElement | null>, enabled: boolean): EditorPanelMode {
  const [mode, setMode] = useState<EditorPanelMode>("all");
  useLayoutEffect(() => {
    const element = ref.current;
    if (!enabled || !element) { setMode("all"); return; }
    const measure = () => {
      const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      const width = element.getBoundingClientRect().width;
      setMode(editorPanelMode(width > 0 ? width - SEPARATORS_PX : 0, rem));
    };
    measure();
    window.addEventListener("resize", measure);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(element);
    return () => { observer?.disconnect(); window.removeEventListener("resize", measure); };
  }, [ref, enabled]);
  return mode;
}
