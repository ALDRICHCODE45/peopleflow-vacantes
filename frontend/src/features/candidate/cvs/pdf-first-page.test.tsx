import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { Cv } from "@/features/candidate-cvs/model";
import { cv } from "@/features/candidate-cvs/test-fixtures";
import { CvPreview } from "./cv-preview";
import { pdfPageRenderer } from "./pdf-preview";
import { clearFirstPageCache } from "./pdf-page";

// pdf.js cannot run in jsdom: the module is replaced by a controllable double with the same surface the renderer uses.
const pdfjs = vi.hoisted(() => ({
  getDocument: vi.fn(),
  GlobalWorkerOptions: { workerSrc: "" },
  AnnotationMode: { DISABLE: 0, ENABLE: 1, ENABLE_FORMS: 2, ENABLE_STORAGE: 3 },
  VerbosityLevel: { ERRORS: 0, WARNINGS: 1, INFOS: 5 },
}));
vi.mock("pdfjs-dist", () => pdfjs);

const WORD = "application/vnd.openxmlformats-officedocument.wordprocessingml.document" as const;
const word: Cv = { ...cv, id: "b12b3456-1234-4234-8234-123456789abc", name: "CV Almacén.docx", content_type: WORD };
const other: Cv = { ...cv, id: "c12b3456-1234-4234-8234-123456789abc", name: "CV Inglés.pdf" };
const url = (id: string) => `/api/candidate/cvs/${id}/file`;
const pdfResponse = () => new Response(new Uint8Array([0x25, 0x50, 0x44, 0x46]), { status: 200, headers: { "content-type": "application/pdf" } });

/** A loading task whose document is resolved by the test; `rendered` is the canvas pdf.js drew into. */
function loadingTask() {
  let resolve!: (doc: unknown) => void, reject!: (error: Error) => void;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  promise.catch(() => {}); // a rejection set up before pdf.js is asked for the document is not an unhandled one
  const task = { promise, destroy: vi.fn(async () => {}), rendered: undefined as HTMLCanvasElement | undefined };
  const page = {
    getViewport: ({ scale }: { scale: number }) => ({ width: 595 * scale, height: 842 * scale }),
    render: vi.fn(({ canvas }: { canvas: HTMLCanvasElement }) => { task.rendered = canvas; return { promise: Promise.resolve(), cancel: vi.fn() }; }),
    cleanup: vi.fn(),
  };
  const doc = { numPages: 3, getPage: vi.fn(async () => page), destroy: vi.fn(async () => {}) };
  return Object.assign(task, { page, doc, open: () => resolve(doc), fail: (error = new Error("Invalid PDF structure")) => reject(error) });
}

const fetchMock = vi.fn();
const drawImage = vi.fn();
beforeEach(() => {
  clearFirstPageCache();
  pdfjs.getDocument.mockReset(); pdfjs.GlobalWorkerOptions.workerSrc = "";
  fetchMock.mockReset().mockImplementation(async () => pdfResponse());
  vi.stubGlobal("fetch", fetchMock);
  drawImage.mockReset();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => ({ drawImage }) as never);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const preview = (doc: Cv, size: "panel" | "compact" = "panel") => <CvPreview cv={doc} size={size} renderPage={pdfPageRenderer(doc, size)} />;
const figure = (doc: Cv) => screen.getByRole("figure", { name: `Vista previa de ${doc.name}` });

describe("PDF first-page preview", () => {
  it("renders page 1 of a PDF from the same-origin file route, with eval, XFA and streaming off", async () => {
    const task = loadingTask(); pdfjs.getDocument.mockReturnValue(task);
    render(preview(cv));
    await waitFor(() => expect(pdfjs.getDocument).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(url(cv.id));
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ credentials: "same-origin" });
    expect(pdfjs.getDocument.mock.calls[0][0]).toMatchObject({ isEvalSupported: false, enableXfa: false, disableAutoFetch: true, disableStream: true, disableRange: true, useWorkerFetch: false });
    expect(pdfjs.getDocument.mock.calls[0][0].data).toBeInstanceOf(Uint8Array);
    expect(pdfjs.GlobalWorkerOptions.workerSrc).toMatch(/pdf\.worker\.min\.mjs$/);
    // While it loads: an A4 skeleton inside the figure, which does not pulse under reduced motion.
    expect(figure(cv).querySelector("[data-pf-pdf-state=loading]")).not.toBeNull();
    expect(figure(cv).querySelector("[data-slot=skeleton]")).toHaveClass("motion-reduce:animate-none");
    task.open();
    await waitFor(() => expect(figure(cv).querySelector("[data-pf-pdf-state=ready]")).not.toBeNull());
    expect(task.doc.getPage).toHaveBeenCalledWith(1);
    expect(task.doc.getPage).toHaveBeenCalledTimes(1);
    expect(task.page.render).toHaveBeenCalledWith(expect.objectContaining({ annotationMode: pdfjs.AnnotationMode.ENABLE }));
    expect(drawImage).toHaveBeenCalledWith(task.rendered, 0, 0);
    expect(task.destroy).toHaveBeenCalled();
  });
  it("hides the canvas from assistive technology and names the page with a visually hidden label", async () => {
    const task = loadingTask(); pdfjs.getDocument.mockReturnValue(task); task.open();
    render(preview(cv));
    const label = await screen.findByText(`Primera página de ${cv.name}`);
    expect(label).toHaveClass("sr-only");
    const canvas = figure(cv).querySelector("canvas")!;
    expect(canvas).toHaveAttribute("aria-hidden", "true");
    expect(canvas).toHaveAttribute("data-pf-pdf-page", cv.id);
  });
  it("keeps Word files on the «Sin vista previa» placeholder without fetching or loading pdf.js", async () => {
    expect(pdfPageRenderer(word, "panel")).toBeUndefined();
    render(preview(word));
    expect(figure(word)).toHaveAttribute("data-state", "placeholder");
    expect(screen.getByText("Sin vista previa en el navegador. Descárgalo para verlo.")).toBeInTheDocument();
    await new Promise(done => setTimeout(done, 20));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(pdfjs.getDocument).not.toHaveBeenCalled();
  });
  it("falls back to the honest placeholder with «No pudimos mostrar la vista previa» when pdf.js rejects", async () => {
    const task = loadingTask(); pdfjs.getDocument.mockReturnValue(task); task.fail();
    render(preview(cv));
    expect(await screen.findByText("No pudimos mostrar la vista previa")).toBeInTheDocument();
    expect(screen.getByText(cv.name)).toBeInTheDocument();
    expect(screen.getByText("PDF · 340 KB")).toBeInTheDocument();
    expect(figure(cv).querySelector("canvas")).toBeNull();
    expect(task.destroy).toHaveBeenCalled();
  });
  it("falls back when the download fails or is not a PDF, without calling pdf.js", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ error: "not_found" }, { status: 404 }));
    render(preview(cv, "compact"));
    expect(await screen.findByText("No pudimos mostrar la vista previa")).toBeInTheDocument();
    cleanup();
    fetchMock.mockResolvedValueOnce(new Response("<html>", { status: 200, headers: { "content-type": "text/html" } }));
    render(preview(other));
    expect(await screen.findByText("No pudimos mostrar la vista previa")).toBeInTheDocument();
    expect(pdfjs.getDocument).not.toHaveBeenCalled();
  });
  it("never downloads a file over the 5 MB limit", async () => {
    render(preview({ ...cv, size: 5_242_881 }));
    expect(await screen.findByText("No pudimos mostrar la vista previa")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("caches the rendered page per CV id: showing the same CV again does not fetch or parse it again", async () => {
    const task = loadingTask(); pdfjs.getDocument.mockReturnValue(task); task.open();
    const view = render(preview(cv));
    await waitFor(() => expect(figure(cv).querySelector("[data-pf-pdf-state=ready]")).not.toBeNull());
    view.rerender(preview(other));
    view.rerender(preview(cv, "compact"));
    await waitFor(() => expect(figure(cv).querySelector("[data-pf-pdf-state=ready]")).not.toBeNull());
    expect(fetchMock.mock.calls.filter(([href]) => href === url(cv.id))).toHaveLength(1);
    expect(pdfjs.getDocument.mock.calls.length).toBeLessThanOrEqual(2);
  });
  it("ignores a stale render after the selection changes and destroys its loading task", async () => {
    const first = loadingTask(), second = loadingTask();
    pdfjs.getDocument.mockReturnValueOnce(first).mockReturnValueOnce(second);
    const view = render(preview(cv));
    await waitFor(() => expect(pdfjs.getDocument).toHaveBeenCalledTimes(1));
    view.rerender(preview(other));
    await waitFor(() => expect(pdfjs.getDocument).toHaveBeenCalledTimes(2));
    expect(first.destroy).toHaveBeenCalled();
    second.open();
    await waitFor(() => expect(figure(other).querySelector("canvas")).toHaveAttribute("data-pf-pdf-page", other.id));
    first.open();
    await new Promise(done => setTimeout(done, 20));
    expect(first.page.render).not.toHaveBeenCalled();
    expect(drawImage).toHaveBeenCalledTimes(1);
    expect(drawImage).toHaveBeenCalledWith(second.rendered, 0, 0);
    expect(figure(other).querySelector("canvas")).toHaveAttribute("data-pf-pdf-page", other.id);
  });
});
