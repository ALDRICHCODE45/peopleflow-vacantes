"use client";

import { useEffect, useState, type CSSProperties } from "react";

type Rect = Pick<DOMRect, "left" | "top" | "bottom" | "height">;
type Offsets = { right?: number; bottom?: number };
type PlacementStyle = CSSProperties & {
  "--pf-toast-right"?: string;
  "--pf-toast-bottom"?: string;
};
const GAP = 12;

/** Missing offsets deliberately retain the CSS safe-area/save-bar defaults. */
export function getToastOffsets(
  sheet: Rect | null,
  footer: Rect | null,
  viewportWidth: number,
  toastWidth: number,
  viewportHeight: number,
): Offsets {
  if (!sheet) return {};
  if (sheet.left >= toastWidth + 2 * GAP) {
    return { right: viewportWidth - sheet.left + GAP };
  }
  return footer ? { bottom: Math.max(0, viewportHeight - footer.top) + GAP } : {};
}

export function useToastPlacement(): PlacementStyle {
  const [style, setStyle] = useState<PlacementStyle>({});

  useEffect(() => {
    let sheet: HTMLElement | undefined;
    let footer: HTMLElement | null = null;
    const measure = () => {
      const viewport = document.querySelector<HTMLElement>("[data-pf-toaster] [data-sileo-viewport]");
      const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      // Read the rendered --sileo-width, with the same fallback for an empty host.
      const toastWidth = viewport?.getBoundingClientRect().width || Math.min(350, window.innerWidth - 3 * rem);
      const offsets = getToastOffsets(
        sheet?.getBoundingClientRect() ?? null,
        footer?.getBoundingClientRect() ?? null,
        window.innerWidth,
        toastWidth,
        window.innerHeight,
      );
      const next: PlacementStyle = {
        ...(offsets.right === undefined ? {} : { "--pf-toast-right": `${offsets.right}px` }),
        ...(offsets.bottom === undefined ? {} : { "--pf-toast-bottom": `${offsets.bottom}px` }),
      };
      setStyle((current) => current["--pf-toast-right"] === next["--pf-toast-right"] &&
        current["--pf-toast-bottom"] === next["--pf-toast-bottom"] ? current : next);
    };
    // Without ResizeObserver (older engines, jsdom) the window resize listener still applies.
    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    const discover = () => {
      // Sheet portals follow opening order; the last open right popup is the
      // innermost/topmost one. Closed popups may remain mounted for their exit.
      const sheets = document.querySelectorAll<HTMLElement>(
        '[data-slot="sheet-content"][data-side="right"][data-open]:not([data-closed]):not([hidden])',
      );
      const nextSheet = sheets.item(sheets.length - 1) ?? undefined;
      const nextFooter = nextSheet?.querySelector<HTMLElement>('[data-slot="sheet-footer"]') ?? null;
      if (sheet !== nextSheet || footer !== nextFooter) {
        resizeObserver?.disconnect();
        sheet = nextSheet;
        footer = nextFooter;
        if (sheet) resizeObserver?.observe(sheet);
        if (footer) resizeObserver?.observe(footer);
      }
      measure();
    };
    const mutations = new MutationObserver(discover);
    mutations.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-open", "data-closed", "data-side", "data-starting-style", "hidden"],
    });
    window.addEventListener("resize", measure);
    discover();
    return () => {
      mutations.disconnect();
      resizeObserver?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  return style;
}
