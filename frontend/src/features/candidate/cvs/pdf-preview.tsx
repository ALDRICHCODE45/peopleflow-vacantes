"use client";
import type { ReactNode } from "react";
import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/skeleton";
import type { Cv } from "@/features/candidate-cvs/model";
import { CvPlaceholder, type CvPreviewSize } from "./cv-preview";
import { isPdf } from "./format";

type PdfFirstPageProps = { cv: Pick<Cv, "id" | "name" | "content_type" | "size">; size: CvPreviewSize };
/** If the renderer chunk itself cannot load, the panel keeps the honest placeholder instead of throwing. */
function ChunkFailed({ cv, size }: PdfFirstPageProps) { return <div data-pf-pdf-state="failed" className="size-full"><CvPlaceholder cv={cv} size={size} note="No pudimos mostrar la vista previa" /></div>; }
/**
 * The pdf.js renderer, loaded on the client only (`ssr: false`) and only when a PDF preview is shown: the component, its
 * loader and pdf.js itself (imported inside the loader) are split out of the page and the server bundles.
 */
const PdfFirstPage = dynamic<PdfFirstPageProps>(() => import("./pdf-first-page").then(module => module.PdfFirstPage, () => ChunkFailed), {
  ssr: false,
  loading: () => <div data-pf-pdf-state="loading" aria-busy="true" className="size-full"><Skeleton aria-hidden="true" className="size-full rounded-none motion-reduce:animate-none" /></div>,
});

/** The `renderPage` of `CvPreview` for a CV: page 1 via pdf.js for a PDF; none for Word, which keeps its placeholder. */
export function pdfPageRenderer(cv: PdfFirstPageProps["cv"], size: CvPreviewSize): (() => ReactNode) | undefined {
  if (!isPdf(cv)) return undefined;
  return function PdfPage() { return <PdfFirstPage key={cv.id} cv={cv} size={size} />; };
}
