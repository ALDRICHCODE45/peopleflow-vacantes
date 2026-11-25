"use client";

import { useEffect, useRef, useState } from "react";
import { IconArrowBackUp, IconArrowForwardUp } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

// Native undo stays with text controls; ours handles everything else on the page.
const TEXT_CONTROL = 'textarea, select, [contenteditable]:not([contenteditable="false"]), input:not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="range"]):not([type="color"]):not([type="file"])';
// Shortcuts belong to the editor page, not to an open dialog, sheet, menu or popover.
const OVERLAY = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]';

export type HistoryShortcut = "undo" | "redo" | null;
/** Ctrl/⌘+Z undoes; Ctrl/⌘+Shift+Z and Ctrl+Y redo. */
export function historyShortcut(event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "shiftKey" | "altKey">): HistoryShortcut {
  if (event.altKey || !(event.ctrlKey || event.metaKey)) return null;
  const key = event.key.toLowerCase();
  if (key === "z") return event.shiftKey ? "redo" : "undo";
  if (key === "y" && event.ctrlKey && !event.metaKey && !event.shiftKey) return "redo";
  return null;
}
export function useHistoryShortcuts(onUndo: () => void, onRedo: () => void) {
  const handlers = useRef({ onUndo, onRedo });
  useEffect(() => { handlers.current = { onUndo, onRedo }; });
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      const shortcut = historyShortcut(event);
      if (!shortcut || event.defaultPrevented) return;
      if (event.target instanceof Element && event.target.closest(TEXT_CONTROL)) return;
      if (document.querySelector(OVERLAY)) return;
      event.preventDefault();
      if (shortcut === "undo") handlers.current.onUndo(); else handlers.current.onRedo();
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, []);
}
const isApple = () => typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);
export function HistoryControls({ canUndo, canRedo, onUndo, onRedo }: { canUndo: boolean; canRedo: boolean; onUndo: () => void; onRedo: () => void }) {
  // The client-only editor session renders this, so the platform is known on first paint.
  const [apple] = useState(isApple);
  const undoHint = apple ? "⌘Z" : "Ctrl+Z";
  const redoHint = apple ? "⇧⌘Z" : "Ctrl+Y";
  return <div role="group" aria-label="Historial de cambios" className="flex items-center gap-1">
    <Tooltip><TooltipTrigger render={<Button variant="ghost" size="icon" className="size-10" aria-label="Deshacer" aria-keyshortcuts="Control+Z Meta+Z" disabled={!canUndo} onClick={onUndo} />}><IconArrowBackUp aria-hidden="true" /></TooltipTrigger><TooltipContent>Deshacer ({undoHint})</TooltipContent></Tooltip>
    <Tooltip><TooltipTrigger render={<Button variant="ghost" size="icon" className="size-10" aria-label="Rehacer" aria-keyshortcuts="Control+Y Control+Shift+Z Meta+Shift+Z" disabled={!canRedo} onClick={onRedo} />}><IconArrowForwardUp aria-hidden="true" /></TooltipTrigger><TooltipContent>Rehacer ({redoHint})</TooltipContent></Tooltip>
  </div>;
}
