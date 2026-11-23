"use client";

import { createContext, useContext, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * The slot in the vacancy frame's tab row (S9). `undefined` = no frame around the caller; `null` = inside a frame whose slot
 * has not mounted yet; an element = where a tab's content may place one line beside the tabs (the replacement link).
 * It lives apart from the frame so board code can use it without importing the frame (which imports board code).
 */
export const VacancyTabRowContext = createContext<HTMLElement | null | undefined>(undefined);

/** Renders `children` in the frame's tab row, or in place when there is no frame (a board mounted on its own). */
export function InVacancyTabRow({ children }: { children: ReactNode }) {
  const slot = useContext(VacancyTabRowContext);
  if (slot === undefined) return <>{children}</>;
  return slot ? createPortal(children, slot) : null;
}
