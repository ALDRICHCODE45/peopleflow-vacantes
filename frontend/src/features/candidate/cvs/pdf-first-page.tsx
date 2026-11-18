"use client";
import { useEffect, useRef, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import type { Cv } from "@/features/candidate-cvs/model";
import { CvPlaceholder, type CvPreviewSize } from "./cv-preview";
import { loadFirstPage, peekFirstPage } from "./pdf-page";

export const PREVIEW_FAILED = "No pudimos mostrar la vista previa";
type PdfDocument = Pick<Cv, "id" | "name" | "content_type" | "size">;
type Result = { id: string; page?: HTMLCanvasElement };

/** A4 skeleton page while page 1 loads; still under reduced motion. */
export function PdfPageSkeleton({ name }: { name?: string }) {
  return <div data-pf-pdf-state="loading" aria-busy="true" className="size-full">
    <Skeleton aria-hidden="true" className="size-full rounded-none motion-reduce:animate-none" />
    {name && <span className="sr-only">Cargando la primera página de {name}</span>}
  </div>;
}

/**
 * Page 1 of a PDF CV inside the `CvPreview` A4 slot: a skeleton while it loads, the page drawn on a canvas, or the honest
 * placeholder with «No pudimos mostrar la vista previa» when it cannot be shown. A render for a CV that is no longer
 * shown is ignored (and aborted when nothing else waits for it).
 */
export function PdfFirstPage({ cv, size }: { cv: PdfDocument; size: CvPreviewSize }) {
  const [result, setResult] = useState<Result>();
  const canvas = useRef<HTMLCanvasElement>(null);
  const { id, size: bytes } = cv;
  useEffect(() => {
    let active = true;
    const request = loadFirstPage({ id, size: bytes });
    request.promise.then(page => { if (active) setResult({ id, page }); }, () => { if (active) setResult({ id }); });
    return () => { active = false; request.release(); };
  }, [id, bytes]);
  const cached = peekFirstPage(cv.id);
  const page = result?.id === cv.id ? result.page : cached;
  const state = page ? "ready" : result?.id === cv.id ? "failed" : "loading";
  useEffect(() => {
    const target = canvas.current;
    if (!target || !page) return;
    target.width = page.width; target.height = page.height;
    target.getContext("2d")?.drawImage(page, 0, 0);
  }, [page]);
  if (state === "failed") return <div data-pf-pdf-state="failed" className="size-full"><CvPlaceholder cv={cv} size={size} note={PREVIEW_FAILED} /></div>;
  if (state === "loading") return <PdfPageSkeleton name={cv.name} />;
  return <div data-pf-pdf-state="ready" className="size-full bg-white">
    <canvas ref={canvas} aria-hidden="true" data-pf-pdf-page={cv.id} className="block h-auto w-full" />
    <span className="sr-only">Primera página de {cv.name}</span>
  </div>;
}
