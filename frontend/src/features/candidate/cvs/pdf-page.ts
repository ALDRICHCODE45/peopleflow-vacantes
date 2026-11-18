import { cvRowActions, HARD_MAX_BYTES, type Cv } from "@/features/candidate-cvs/model";

/**
 * Page 1 of a PDF CV, drawn by pdf.js into an off-screen canvas (T12b). Client only: pdf.js is imported on demand, so it
 * is a separate chunk that only `/candidato/cvs` requests, and it never runs on the server.
 *
 * The page is drawn once at the width of the preview panel's page (320 CSS px, `max-w-80`) times the device pixel ratio,
 * and kept per CV id for the session: the panel and the 104 px slot of an expanded row both scale that bitmap down, so
 * switching rows never downloads or parses a file again. Failures are kept too (no refetch loop on a broken file); an
 * aborted render is forgotten so it can start again.
 */
export const PAGE_CSS_WIDTH = 320;
const MAX_PIXEL_RATIO = 3;
/** A4 is 1.414; taller pages are cropped at the top part the A4 slot shows anyway. */
const MAX_PAGE_RATIO = 1.5;
/** Images over 16 megapixels are skipped instead of decoded (a CV photo is far below). */
const MAX_IMAGE_PIXELS = 4096 * 4096;

type FirstPageDocument = Pick<Cv, "id" | "size">;
type Entry = { promise: Promise<HTMLCanvasElement>; controller: AbortController; users: number; settled: boolean; page?: HTMLCanvasElement };
const pages = new Map<string, Entry>();

export class PreviewUnavailable extends Error {
  constructor(readonly reason: "too_large" | "download" | "not_pdf" | "aborted") { super(`PDF preview unavailable: ${reason}`); }
}

/** The page already drawn for this CV, if any (to paint it on the first render, without a skeleton frame). */
export function peekFirstPage(id: string): HTMLCanvasElement | undefined { return pages.get(id)?.page; }

/** Test seam: forget every page of the session. */
export function clearFirstPageCache() { for (const entry of pages.values()) if (!entry.settled) entry.controller.abort(); pages.clear(); }

/**
 * Starts (or joins) the render of page 1 of `cv`. Call `release` when the page is no longer shown: once nobody waits for
 * an unfinished render, its download is aborted and its pdf.js task destroyed.
 */
export function loadFirstPage(cv: FirstPageDocument): { promise: Promise<HTMLCanvasElement>; release: () => void } {
  let entry = pages.get(cv.id);
  if (!entry) {
    const controller = new AbortController();
    const created: Entry = { controller, users: 0, settled: false, promise: Promise.resolve(undefined as never) };
    created.promise = renderFirstPage(cv, controller.signal).then(
      page => { created.settled = true; created.page = page; return page; },
      (error: unknown) => {
        created.settled = true;
        if (controller.signal.aborted && pages.get(cv.id) === created) pages.delete(cv.id);
        throw error;
      });
    created.promise.catch(() => {}); // callers handle it; the cached rejection itself is not an unhandled one
    pages.set(cv.id, created);
    entry = created;
  }
  const current = entry;
  current.users += 1;
  let released = false;
  return { promise: current.promise, release: () => {
    if (released) return;
    released = true;
    current.users -= 1;
    if (current.settled || current.users > 0) return;
    current.controller.abort();
    if (pages.get(cv.id) === current) pages.delete(cv.id);
  } };
}

function throwIfAborted(signal: AbortSignal) { if (signal.aborted) throw new PreviewUnavailable("aborted"); }

async function renderFirstPage(cv: FirstPageDocument, signal: AbortSignal): Promise<HTMLCanvasElement> {
  // The upload rule (5 MB) bounds what the preview will ever download and hand to pdf.js.
  if (cv.size > HARD_MAX_BYTES) throw new PreviewUnavailable("too_large");
  const [download] = cvRowActions(cv);
  const response = await fetch(download.href, { credentials: "same-origin", cache: "no-store", signal });
  throwIfAborted(signal);
  if (!response.ok) throw new PreviewUnavailable("download");
  if (!(response.headers.get("content-type") ?? "").toLowerCase().startsWith("application/pdf")) throw new PreviewUnavailable("not_pdf");
  if (Number(response.headers.get("content-length") ?? 0) > HARD_MAX_BYTES) throw new PreviewUnavailable("too_large");
  const data = await response.arrayBuffer();
  throwIfAborted(signal);
  if (data.byteLength === 0) throw new PreviewUnavailable("download");
  if (data.byteLength > HARD_MAX_BYTES) throw new PreviewUnavailable("too_large");

  const pdfjs = await import("pdfjs-dist");
  throwIfAborted(signal);
  // The worker ships from this app (the bundler emits it as an asset); nothing loads from a CDN.
  if (!pdfjs.GlobalWorkerOptions.workerSrc) pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
  const options = {
    data: new Uint8Array(data),
    // pdf.js 6 no longer compiles PDF functions or fonts with eval (the option was removed); kept explicit as a guard
    // should a different pdf.js build ever read it.
    isEvalSupported: false,
    enableXfa: false, // no XFA forms
    // The whole file is already in memory: no range requests, streaming or prefetching.
    disableAutoFetch: true, disableStream: true, disableRange: true,
    useWorkerFetch: false, // the worker never fetches (no CMap, font or wasm downloads)
    pdfBug: false,
    maxImageSize: MAX_IMAGE_PIXELS,
    verbosity: pdfjs.VerbosityLevel.ERRORS,
  };
  const task = pdfjs.getDocument(options);
  const abort = () => { void task.destroy(); };
  signal.addEventListener("abort", abort, { once: true });
  try {
    const pdf = await task.promise;
    throwIfAborted(signal);
    const page = await pdf.getPage(1);
    throwIfAborted(signal);
    const ratio = Math.min(Math.max(globalThis.devicePixelRatio || 1, 1), MAX_PIXEL_RATIO);
    const viewport = page.getViewport({ scale: PAGE_CSS_WIDTH * ratio / page.getViewport({ scale: 1 }).width });
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.floor(viewport.width));
    canvas.height = Math.max(1, Math.floor(Math.min(viewport.height, viewport.width * MAX_PAGE_RATIO)));
    // Annotation appearances only (what a printed page shows); no interactive forms, no scripting: nothing here loads
    // the annotation layer or the pdf.js scripting sandbox.
    await page.render({ canvas, viewport, annotationMode: pdfjs.AnnotationMode.ENABLE }).promise;
    throwIfAborted(signal);
    return canvas;
  } finally {
    signal.removeEventListener("abort", abort);
    await task.destroy();
  }
}
