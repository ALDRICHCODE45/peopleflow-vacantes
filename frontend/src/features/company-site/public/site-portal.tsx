"use client";

import { createContext, useContext } from "react";

/** PreviewFrame supplies its visible-region box; the presentation scopes its
 * theme inside that box and provides the resulting mount to overlays. Without
 * a preview, the public site provides its ordinary root. Null waits for a ref;
 * undefined means no provider (standalone consumers fall back to body). */
export const SitePortalContext = createContext<HTMLElement | null | undefined>(undefined);

export function useSitePortalContainer() {
  const root = useContext(SitePortalContext);
  return root === undefined ? (typeof document === "undefined" ? undefined : document.body) : root;
}
