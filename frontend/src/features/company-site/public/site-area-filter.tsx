"use client";
import { createContext, useContext } from "react";

/** One page-level source of truth for the «Área» vacancy filter, shared by the
 * «Áreas de trabajo» cards and the Vacantes section's own filters. */
export type SiteAreaFilter = {
  areas: string[];
  setAreas: (areas: string[]) => void;
  /** Filter the vacancies by one area and bring the Vacantes section into view. */
  showArea: (area: string) => void;
  /** Only pages with an «Áreas de trabajo» section show the removable area chip. */
  chips: boolean;
};
export const SiteAreaFilterContext = createContext<SiteAreaFilter | null>(null);
export const useSiteAreaFilter = () => useContext(SiteAreaFilterContext);
