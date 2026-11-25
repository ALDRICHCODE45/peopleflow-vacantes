"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

/** Where the section being dragged would land: `toIndex` is its final index in
 * the reordered list; `allowed` is false for a forbidden position. */
export type SectionDragPreview = { activeId: string; toIndex: number; allowed: boolean } | null;
type Report = (preview: SectionDragPreview) => void;

const PreviewContext = createContext<SectionDragPreview>(null);
const noop: Report = () => {};
const ReportContext = createContext<Report>(noop);

/** Optional: share the list's drag state with siblings (e.g. the preview's
 * insertion line). Without it, the list reports into a no-op. */
export function SectionDragPreviewProvider({ children }: { children: ReactNode }) {
  const [preview, setPreview] = useState<SectionDragPreview>(null);
  return <ReportContext.Provider value={setPreview}><PreviewContext.Provider value={preview}>{children}</PreviewContext.Provider></ReportContext.Provider>;
}
export const useSectionDragPreview = () => useContext(PreviewContext);
export const useReportSectionDragPreview = () => useContext(ReportContext);
