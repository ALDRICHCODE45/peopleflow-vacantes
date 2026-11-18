import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { readFileSync, readdirSync } from "node:fs";
vi.mock("@/features/candidate-cvs/actions", () => ({ loadCvsAction: vi.fn(), renameCvAction: vi.fn(), deleteCvAction: vi.fn() }));
vi.mock("@/components/feedback/notify", () => ({ notifyActionResult: vi.fn() }));
// Base UI menu positioning cannot settle in jsdom; the shared deterministic double keeps the same roles.
vi.mock("@/components/ui/dropdown-menu", async () => (await import("@/components/data-table/test-menu")).menuDouble);
// The pdf.js first page has its own suite (cvs/pdf-first-page.test.tsx); here the loader only records which CVs ask for it.
vi.mock("@/features/candidate/cvs/pdf-page", () => ({ loadFirstPage: vi.fn(), peekFirstPage: vi.fn(), clearFirstPageCache: vi.fn() }));
import { deleteCvAction, loadCvsAction, renameCvAction } from "@/features/candidate-cvs/actions";
import { notifyActionResult } from "@/components/feedback/notify";
import { loadFirstPage } from "@/features/candidate/cvs/pdf-page";
import type { Cv } from "@/features/candidate-cvs/model";
import { cv, library } from "@/features/candidate-cvs/test-fixtures";
import { CvWorkspace } from "./cv-workspace";
// Keep the real popover controls; only replace the jsdom-looping anchored shell.
vi.mock("@/components/ui/popover", async importOriginal => ({
  ...await importOriginal<typeof import("@/components/ui/popover")>(),
  PopoverContent: ({ children }: { children?: ReactNode }) => children ? <div role="dialog" aria-label="Ayuda">{children}</div> : null,
}));

const WORD = "application/vnd.openxmlformats-officedocument.wordprocessingml.document" as const;
const word: Cv = { id: "b12b3456-1234-4234-8234-123456789abc", name: "CV Coordinación de Almacén y Distribución 2026.docx", size: 94208, content_type: WORD, uploaded_at: "2026-02-01T12:00:00Z", in_use: false };
const third: Cv = { id: "c12b3456-1234-4234-8234-123456789abc", name: "CV Inglés.pdf", size: 186000, content_type: "application/pdf", uploaded_at: "2026-01-05T12:00:00Z", in_use: false };
const uploaded: Cv = { id: "d12b3456-1234-4234-8234-123456789abc", name: "CV Nuevo", size: 2048, content_type: "application/pdf", uploaded_at: "2026-11-18T12:00:00Z", in_use: false };
const fetchMock = vi.fn();
let narrow = false;
beforeEach(() => {
  narrow = false;
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: narrow, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("fetch", fetchMock); fetchMock.mockReset(); vi.mocked(notifyActionResult).mockReset();
  vi.mocked(loadCvsAction).mockReset().mockResolvedValue({ ok: true, data: library });
  vi.mocked(renameCvAction).mockReset(); vi.mocked(deleteCvAction).mockReset();
  vi.mocked(loadFirstPage).mockReset().mockImplementation(() => ({ promise: new Promise<never>(() => {}), release: vi.fn() }));
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

const withItems = (...items: Cv[]) => vi.mocked(loadCvsAction).mockResolvedValue({ ok: true, data: { ...library, items } });
async function ready() { const rendered = render(<CvWorkspace />); await screen.findByRole("heading", { name: /^Biblioteca/ }); return rendered; }
const row = (name: string) => screen.getByRole("button", { name: accessible => accessible.startsWith(name) });
const panel = () => screen.getByRole("complementary");
function selectFile(file: File) { fireEvent.change(screen.getByLabelText("Archivo del CV"), { target: { files: [file] } }); }
const unavailableTitle = "Los CVs no están disponibles en este momento";
const unavailableDescription = "Puedes intentarlo más tarde; lo que ya escribiste se conserva.";

describe("header and library", () => {
  it("titles the page, summarises the library and offers «Subir CV», which opens the file picker", async () => {
    withItems(cv, word); await ready();
    expect(screen.getByRole("heading", { level: 2, name: "Tus CVs" })).toBeVisible();
    expect(screen.getByText((_, node) => node?.tagName === "P" && node.textContent === "2 de 10 CVs · 1 en uso · PDF o Word, hasta 5 MB")).toBeVisible();
    const click = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => {});
    const upload = screen.getByRole("button", { name: "Subir CV" });
    expect(upload).toHaveClass("min-h-11");
    fireEvent.click(upload);
    expect(click).toHaveBeenCalledTimes(1);
    click.mockRestore();
  });
  it("lists the CVs in a library card with the drop row, file tiles, meta, the «En uso» chip and the capacity bar", async () => {
    withItems(cv, word); await ready();
    const card = screen.getByRole("heading", { name: /^Biblioteca/ }).closest("section")!;
    expect(screen.getByRole("heading", { name: /^Biblioteca/ })).toHaveTextContent("Biblioteca 2");
    expect(within(card).getByText("Más reciente primero")).toBeVisible();
    const drop = within(card).getByRole("region", { name: "Subir un CV" });
    expect(within(drop).getByText("Sube otra versión")).toBeVisible();
    expect(within(drop).getByText("Arrastra un PDF o Word aquí. Hasta 5 MB.")).toBeVisible();
    expect(within(drop).getByRole("button", { name: "Elegir archivo" })).toBeEnabled();
    const list = within(card).getByRole("list", { name: "Tus CVs, el más reciente primero" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    const first = row(cv.name);
    expect(first).toHaveTextContent("PDF · 340 KB · 10 mar 2026");
    expect(within(first).getByText("En uso")).toHaveAttribute("data-variant", "success");
    expect(row(word.name)).toHaveTextContent("Word · 92 KB · 1 feb 2026");
    expect(within(row(word.name)).queryByText("En uso")).toBeNull();
    expect(within(row(word.name)).getByText("DOCX")).toBeInTheDocument();
    expect(within(card).getByText("2 de 10 · quedan 8")).toBeVisible();
    expect(within(card).getByRole("progressbar")).toHaveAttribute("aria-valuenow", "20");
  });
  it("lets a long file name wrap to two lines with word breaks so its extension shows at 390 px", async () => {
    withItems(word); await ready();
    const name = row(word.name).querySelector("[data-pf-cv-name]")!;
    expect(name).toHaveTextContent(word.name);
    expect(name).toHaveClass("line-clamp-2", "break-words");
    expect(name).not.toHaveClass("truncate");
    // The full name stays available on hover when even two lines are not enough.
    expect(name).toHaveAttribute("title", word.name);
  });
  it("keeps semantic paint: no raw colours or dark: overrides in the workspace and its parts", () => {
    const files = ["src/features/candidate/cv-workspace.tsx", ...readdirSync("src/features/candidate/cvs").filter(file => /\.tsx?$/.test(file) && !file.includes(".test.")).map(file => `src/features/candidate/cvs/${file}`)];
    for (const file of files) expect(readFileSync(file, "utf8")).not.toMatch(/#[0-9a-f]{3,8}\b|(?:rgb|hsl|oklch|color-mix)\(|dark:|space-[xy]-/u);
  });
});

describe("selection and preview panel", () => {
  it("selects the first CV and previews its name, actions, page slot, facts and retention note", async () => {
    withItems(cv, word); await ready();
    expect(row(cv.name)).toHaveAttribute("aria-current", "true");
    expect(row(word.name)).not.toHaveAttribute("aria-current");
    const preview = panel();
    expect(preview).toHaveAccessibleName(cv.name);
    expect(within(preview).getByText("PDF · 340 KB · documento 1 de 2")).toBeVisible();
    expect(within(preview).getByRole("link", { name: `Descargar ${cv.name}` })).toHaveAttribute("href", `/api/candidate/cvs/${cv.id}/file`);
    expect(within(preview).getByRole("button", { name: `Acciones de ${cv.name}` })).toHaveAttribute("aria-haspopup", "menu");
    // A PDF shows its real first page (an A4 skeleton until pdf.js draws it), loaded for this CV only.
    const page = within(preview).getByRole("figure", { name: `Vista previa de ${cv.name}` });
    expect(page).toHaveAttribute("data-state", "page");
    await waitFor(() => expect(vi.mocked(loadFirstPage)).toHaveBeenCalledWith({ id: cv.id, size: cv.size }));
    expect(page.querySelector("[data-pf-pdf-state=loading]")).not.toBeNull();
    const facts = Array.from(preview.querySelectorAll("dl > div")).map(node => [node.querySelector("dt")!.textContent, node.querySelector("dd")!.textContent]);
    expect(facts).toEqual([["Formato", "PDF"], ["Tamaño", "340 KB de 5 MB"], ["Subido", "10 de marzo de 2026"], ["Uso", "En uso"]]);
    expect(within(preview).getByText(/^Enviaste este CV en al menos una postulación\. Cada postulación guarda su copia/)).toBeVisible();
    expect(within(preview).getByRole("button", { name: "Renombrar" })).toBeVisible();
  });
  it("follows a click and the arrow keys, moving focus and aria-current together", async () => {
    withItems(cv, word, third); await ready();
    fireEvent.click(row(word.name));
    expect(row(word.name)).toHaveAttribute("aria-current", "true");
    expect(row(cv.name)).not.toHaveAttribute("aria-current");
    expect(panel()).toHaveAccessibleName(word.name);
    fireEvent.keyDown(row(word.name), { key: "ArrowDown" });
    expect(row(third.name)).toHaveFocus();
    expect(row(third.name)).toHaveAttribute("aria-current", "true");
    fireEvent.keyDown(row(third.name), { key: "ArrowDown" });
    expect(row(third.name)).toHaveAttribute("aria-current", "true");
    fireEvent.keyDown(row(third.name), { key: "ArrowUp" });
    fireEvent.keyDown(row(word.name), { key: "ArrowUp" });
    expect(row(cv.name)).toHaveFocus();
    expect(panel()).toHaveAccessibleName(cv.name);
  });
  it("shows Word honestly: no browser preview, «Sin enviar todavía» and no fabricated role or language", async () => {
    withItems(word); await ready();
    const preview = panel();
    expect(within(preview).getByRole("figure", { name: `Vista previa de ${word.name}` })).toHaveTextContent("Sin vista previa en el navegador. Descárgalo para verlo.");
    expect(within(preview).getByRole("figure", { name: `Vista previa de ${word.name}` })).toHaveAttribute("data-state", "placeholder");
    await new Promise(done => setTimeout(done, 20));
    expect(vi.mocked(loadFirstPage)).not.toHaveBeenCalled();
    const facts = Array.from(preview.querySelectorAll("dl > div")).map(node => node.querySelector("dd")!.textContent);
    expect(facts).toEqual(["Word (.docx)", "92 KB de 5 MB", "1 de febrero de 2026", "Sin enviar todavía"]);
    expect(within(preview).getByText(/^Al postularte eliges cuál de tus CVs enviar/)).toBeVisible();
    expect(screen.queryByText("En uso")).toBeNull(); expect(screen.queryByText("Principal")).toBeNull();
    expect(screen.queryByRole("button", { name: "¿Qué significa en uso?" })).toBeNull();
  });
  it("explains «En uso» only on demand", async () => {
    await ready();
    const description = "Enviaste este CV en al menos una postulación.";
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "¿Qué significa en uso?" }));
    expect(await screen.findByRole("dialog", { name: "Ayuda" })).toHaveTextContent(description);
    expect(screen.getByRole("dialog", { name: "Ayuda" })).toHaveTextContent("Cada postulación guarda su copia: si lo renombras o eliminas, lo que la empresa recibió no cambia.");
    fireEvent.click(screen.getByRole("button", { name: "Cerrar ayuda" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("narrow screens", () => {
  it("shows no panel; the selected row expands in place with the same content and 44 px buttons", async () => {
    narrow = true; withItems(cv, word); await ready();
    expect(screen.queryByRole("complementary")).toBeNull();
    expect(screen.queryByRole("button", { name: "Subir CV" })).toBeNull();
    expect(row(cv.name)).toHaveAttribute("aria-expanded", "true");
    expect(row(cv.name)).not.toHaveAttribute("aria-current");
    const detail = document.getElementById(row(cv.name).getAttribute("aria-controls")!)!;
    expect(within(detail).getByRole("figure", { name: `Vista previa de ${cv.name}` })).toHaveAttribute("data-state", "page");
    await waitFor(() => expect(vi.mocked(loadFirstPage)).toHaveBeenCalledWith({ id: cv.id, size: cv.size }));
    expect(within(detail).getByRole("link", { name: `Descargar ${cv.name}` })).toHaveClass("min-h-11");
    expect(within(detail).getByRole("button", { name: "Renombrar" })).toHaveClass("min-h-11");
    expect(within(detail).getByRole("button", { name: "Eliminar" })).toHaveClass("min-h-11");
    expect(Array.from(detail.querySelectorAll("dt")).map(node => node.textContent)).toEqual(["Formato", "Tamaño", "Subido", "Uso"]);
    expect(within(detail).getByText(/^Enviaste este CV en al menos una postulación\./)).toBeVisible();
    expect(within(screen.getByRole("region", { name: "Subir un CV" })).getByRole("button", { name: "Elegir archivo" })).toHaveClass("min-h-11");
  });
  it("collapses the open row on a second tap, opens another, and only moves focus with the arrows", async () => {
    narrow = true; withItems(cv, word); await ready();
    fireEvent.click(row(cv.name));
    expect(row(cv.name)).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("link", { name: `Descargar ${cv.name}` })).toBeNull();
    fireEvent.click(row(word.name));
    expect(row(word.name)).toHaveAttribute("aria-expanded", "true");
    fireEvent.keyDown(row(word.name), { key: "ArrowUp" });
    expect(row(cv.name)).toHaveFocus();
    expect(row(word.name)).toHaveAttribute("aria-expanded", "true");
  });
});

describe("rename and delete", () => {
  it("renames from the panel with the same 1–120 character rule and keeps the selection", async () => {
    withItems(cv, word); await ready();
    vi.mocked(renameCvAction).mockResolvedValue({ ok: true, data: { ...cv, name: "CV Frontend" } });
    fireEvent.click(within(panel()).getByRole("button", { name: "Renombrar" }));
    const dialog = await screen.findByRole("dialog", { name: "Renombrar CV" });
    fireEvent.change(within(dialog).getByLabelText("Nombre del CV"), { target: { value: "   " } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Guardar nombre" }));
    expect(await within(dialog).findByText("Escribe un nombre de 1 a 120 caracteres.")).toBeVisible();
    expect(renameCvAction).not.toHaveBeenCalled();
    fireEvent.change(within(dialog).getByLabelText("Nombre del CV"), { target: { value: "CV Frontend" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Guardar nombre" }));
    await waitFor(() => expect(panel()).toHaveAccessibleName("CV Frontend"));
    expect(row("CV Frontend")).toHaveAttribute("aria-current", "true");
    expect(screen.getByRole("status")).toHaveTextContent("Nombre actualizado");
  });
  it("deletes from the ⋯ menu with the retention text, then selects and focuses the next CV", async () => {
    withItems(cv, word, third); await ready();
    fireEvent.click(row(word.name));
    vi.mocked(deleteCvAction).mockResolvedValue({ ok: true, data: null });
    fireEvent.click(within(panel()).getByRole("button", { name: `Acciones de ${word.name}` }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Eliminar" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent(`¿Eliminar ${word.name}?`);
    expect(dialog).toHaveTextContent("Tus postulaciones conservan su copia. No se puede deshacer.");
    fireEvent.click(within(dialog).getByRole("button", { name: "Eliminar CV" }));
    await waitFor(() => expect(panel()).toHaveAccessibleName(third.name));
    expect(row(third.name)).toHaveAttribute("aria-current", "true");
    await waitFor(() => expect(row(third.name)).toHaveFocus());
    expect(screen.getByRole("status")).toHaveTextContent("CV eliminado");
    expect(screen.getByText("2 de 10 · quedan 8")).toBeVisible();
  });
  it("selects the previous CV after deleting the last one", async () => {
    withItems(cv, word); await ready();
    fireEvent.click(row(word.name));
    vi.mocked(deleteCvAction).mockResolvedValue({ ok: true, data: null });
    fireEvent.click(within(panel()).getByRole("button", { name: `Acciones de ${word.name}` }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Eliminar" }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Eliminar CV" }));
    await waitFor(() => expect(panel()).toHaveAccessibleName(cv.name));
    await waitFor(() => expect(row(cv.name)).toHaveFocus());
  });
});

describe("upload", () => {
  it.each([false, true])("accepts a file dropped anywhere on the page through the picker path (invalid: %s)", async invalid => {
    await ready();
    fetchMock.mockResolvedValue(Response.json(uploaded, { status: 201 }));
    const file = new File(["pdf"], invalid ? "cv.exe" : "cv.pdf", { type: invalid ? "application/octet-stream" : "application/pdf" });
    const drop = screen.getByRole("region", { name: "Subir un CV" });
    fireEvent.dragOver(screen.getByRole("heading", { level: 2, name: "Tus CVs" }), { dataTransfer: { types: ["Files"] } });
    expect(drop).toHaveAttribute("data-drag-over", "true");
    expect(screen.getByText("Suelta el archivo para subirlo · PDF o Word, hasta 5 MB")).toBeInTheDocument();
    fireEvent.drop(drop, { dataTransfer: { types: ["Files"], files: [file] } });
    expect(screen.queryByText("Suelta el archivo para subirlo · PDF o Word, hasta 5 MB")).toBeNull();
    if (invalid) {
      expect(drop).toHaveAttribute("data-drag-over", "false");
      expect(await screen.findByRole("alert")).toHaveTextContent("Sube un PDF o un documento de Word (.docx).");
      expect(screen.getByText("cv.exe")).toBeVisible();
      expect(fetchMock).not.toHaveBeenCalled();
      expect(screen.getByText("1 de 10 · quedan 9")).toBeVisible();
    } else {
      await waitFor(() => expect(notifyActionResult).toHaveBeenCalledWith(expect.objectContaining({ type: "success", title: "CV subido", description: "Ya puedes usarlo en tus postulaciones." })));
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0][0]).toBe("/api/candidate/cvs");
      expect(fetchMock.mock.calls[0][1].body.get("file")).toBe(file);
      expect(screen.getByText("2 de 10 · quedan 8")).toBeVisible();
      expect(screen.getByRole("region", { name: "Subir un CV" })).toHaveAttribute("data-drag-over", "false");
      // The new CV goes first and becomes the selection.
      expect(row(uploaded.name)).toHaveAttribute("aria-current", "true");
      expect(panel()).toHaveAccessibleName(uploaded.name);
      expect(screen.getByRole("status")).toHaveTextContent("CV subido");
    }
  });
  it.each([
    [new File(["x"], "cv.exe", { type: "application/octet-stream" }), "Sube un PDF o un documento de Word (.docx)."],
    [new File([new Uint8Array(5242881)], "cv.pdf", { type: "application/pdf" }), "El archivo pesa más de 5 MB."],
    [new File([], "vacio.pdf", { type: "application/pdf" }), "El archivo está vacío. Elige otro documento."],
  ])("checks the file before any browser request", async (file, message) => {
    await ready(); selectFile(file);
    expect(await screen.findByText(message)).toBeInTheDocument(); expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Archivo del CV")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("button", { name: "Elegir archivo" })).toHaveFocus();
  });
  it("uploads once to the same-origin route, shows the progress row and confirmed success", async () => {
    await ready(); let resolve!: (value: Response) => void;
    fetchMock.mockReturnValue(new Promise<Response>(done => { resolve = done; }));
    selectFile(new File(["%PDF-"], "cv.pdf", { type: "application/pdf" }));
    const progress = await screen.findByRole("status");
    expect(progress).toHaveTextContent("cv.pdf");
    expect(progress).toHaveTextContent("Subiendo… 0 KB");
    expect(progress).toHaveAttribute("aria-busy", "true");
    expect(progress.querySelector('[data-slot="spinner"]')).not.toBeNull();
    expect(screen.getByRole("button", { name: "Subir CV" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Elegir archivo" })).toBeNull();
    expect(fetchMock.mock.calls[0][0]).toBe("/api/candidate/cvs");
    expect(fetchMock.mock.calls[0][1].body.getAll("file")).toHaveLength(1);
    resolve(Response.json(uploaded, { status: 201 }));
    await waitFor(() => expect(notifyActionResult).toHaveBeenCalledWith(expect.objectContaining({ type: "success", title: "CV subido" })));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Subir CV" })).toBeEnabled();
  });
  it.each([
    [400, "cv_content_mismatch", "El archivo no coincide con su formato. Expórtalo de nuevo como PDF o Word."],
    [409, "cv_library_full", "Ya tienes 10 CVs. Elimina uno para subir otro."],
  ])("maps upload failure %s %s", async (status, code, description) => {
    await ready(); fetchMock.mockResolvedValue(Response.json({ error: "private detail", code }, { status: Number(status) }));
    selectFile(new File(["%PDF-"], "cv.pdf", { type: "application/pdf" }));
    await waitFor(() => expect(notifyActionResult).toHaveBeenCalledWith(expect.objectContaining({ type: "error", description, reference: expect.objectContaining({ status, code }) })));
    expect(screen.getByRole("status")).not.toHaveTextContent("private detail");
    // Focus moves after the failure is reported; wait for it instead of racing the effect under load.
    if (code === "cv_content_mismatch") await waitFor(() => expect(screen.getByRole("button", { name: "Elegir archivo" })).toHaveFocus());
  });
  it.each([[503, "no_response", "No hubo respuesta del servidor"], [502, "unrecognized_response", "No pudimos confirmar el resultado"]])("preserves a sanitized route transport classification %i", async (status, code, title) => {
    await ready(); fetchMock.mockResolvedValue(Response.json({ error: code, code }, { status: Number(status) }));
    selectFile(new File(["%PDF-"], "cv.pdf", { type: "application/pdf" }));
    await waitFor(() => expect(notifyActionResult).toHaveBeenCalledWith(expect.objectContaining({ title })));
  });
  it("never retries an uncertain upload automatically; offers a read-only check", async () => {
    await ready(); fetchMock.mockRejectedValue(new Error("secret"));
    selectFile(new File(["%PDF-"], "cv.pdf", { type: "application/pdf" }));
    expect(await screen.findByRole("button", { name: "Comprobar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Elegir archivo" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Subir CV" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Comprobar" }));
    await waitFor(() => expect(loadCvsAction).toHaveBeenCalledTimes(2));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole("status")).toHaveTextContent("Biblioteca actualizada");
  });
  it("retains the library and gives the storage copy in upload toast and ActionStatus", async () => {
    await ready(); fetchMock.mockResolvedValue(Response.json({ error: "private", code: "cv_storage_unavailable" }, { status: 503 }));
    selectFile(new File(["pdf"], "cv.pdf", { type: "application/pdf" }));
    await waitFor(() => expect(notifyActionResult).toHaveBeenCalledWith(expect.objectContaining({ type: "error", title: unavailableTitle, description: unavailableDescription })));
    expect(screen.getByRole("status")).toHaveTextContent(unavailableTitle);
    expect(screen.getByRole("status")).toHaveTextContent(unavailableDescription);
    expect(panel()).toHaveAccessibleName(cv.name);
    expect(screen.getByRole("button", { name: "Reintentar" })).toBeVisible();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("disables upload at the real limit with the reason shown and associated, and ignores drops", async () => {
    vi.mocked(loadCvsAction).mockResolvedValue({ ok: true, data: { ...library, limits: { ...library.limits, max_cvs: 1 } } });
    await ready();
    const upload = screen.getByRole("button", { name: "Subir CV" });
    expect(upload).toBeDisabled();
    expect(upload).toHaveAccessibleDescription("Ya tienes 1 CVs. Elimina uno para subir otro.");
    expect(screen.getByText("Biblioteca llena")).toBeVisible();
    expect(screen.getByText("Ya tienes 1 CVs. Elimina uno para subir otro.")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Elegir archivo" })).toBeNull();
    expect(screen.getByText("1 de 1 · sin lugares libres")).toBeVisible();
    fireEvent.drop(screen.getByRole("heading", { level: 2, name: "Tus CVs" }), { dataTransfer: { types: ["Files"], files: [new File(["pdf"], "cv.pdf", { type: "application/pdf" })] } });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByText("1 de 1 · sin lugares libres")).toBeVisible();
  });
});

describe("first use, loading and failures", () => {
  it("greets an empty library with the first-use card, its two actions and the upload rules", async () => {
    withItems(); render(<CvWorkspace />);
    const title = await screen.findByRole("heading", { level: 3, name: "Sube tu primer CV" });
    const card = title.closest("section")!;
    expect(within(card).getByText("Tu biblioteca de CVs")).toBeVisible();
    expect(within(card).getByText("Revisa cada versión antes de enviarla: aquí ves su formato, su tamaño y si ya la usaste en una postulación. Hasta 10 CVs.")).toBeVisible();
    expect(within(card).getByRole("button", { name: "Subir CV" })).toHaveClass("bg-primary", "min-h-11");
    expect(within(card).getByRole("link", { name: "Explorar vacantes" })).toHaveAttribute("href", "/vacantes");
    for (const rule of ["PDF o Word (.docx)", "Hasta 5 MB · o arrástralo aquí", "Lo que envíes no cambia"]) expect(within(card).getByText(rule)).toBeVisible();
    expect(screen.getAllByRole("button", { name: "Subir CV" })).toHaveLength(1);
    expect(screen.getByText((_, node) => node?.tagName === "P" && node.textContent === "PDF o Word, hasta 5 MB")).toBeVisible();
    expect(screen.queryByRole("heading", { name: /^Biblioteca/ })).toBeNull();
    expect(screen.getByLabelText("Archivo del CV")).toBeEnabled();
  });
  it("reports an invalid first file in the first-use card and returns focus to «Subir CV»", async () => {
    withItems(); render(<CvWorkspace />);
    await screen.findByRole("heading", { name: "Sube tu primer CV" });
    selectFile(new File(["x"], "foto.png", { type: "image/png" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Sube un PDF o un documento de Word (.docx).");
    expect(screen.getByRole("button", { name: "Subir CV" })).toHaveFocus();
  });
  it("shows skeletons of the header, library and panel while loading, with no counts", () => {
    vi.mocked(loadCvsAction).mockReturnValue(new Promise(() => {}));
    const { container } = render(<CvWorkspace />);
    expect(screen.getByRole("status")).toHaveTextContent("Cargando CVs");
    expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(6);
    expect(container.querySelectorAll("[data-pf-cv-loading-row]")).toHaveLength(2);
    expect(container.querySelector("[data-pf-cv-loading-preview]")).not.toBeNull();
    expect(screen.queryByText(/de 10/)).toBeNull();
    expect(screen.queryByText("Sube tu primer CV")).toBeNull();
  });
  it("plays one entrance when the library first shows, then drops it so selecting never replays it", async () => {
    withItems(cv, word);
    const { container } = await ready();
    const root = container.querySelector("[data-pf-cv-workspace]")!;
    expect(root).toHaveAttribute("data-pf-cv-entrance", "rise");
    await waitFor(() => expect(root).toHaveAttribute("data-pf-cv-entrance", "off"), { timeout: 1500 });
    const aside = panel();
    act(() => { fireEvent.click(row(word.name)); });
    expect(panel()).toBe(aside);
    expect(root).toHaveAttribute("data-pf-cv-entrance", "off");
  });
  it.each(["no_response", "unauthenticated"] as const)("shows a recovery card for initial %s", async reason => {
    vi.mocked(loadCvsAction).mockResolvedValue({ ok: false, reason, reference: {} });
    render(<CvWorkspace />);
    const title = await screen.findByRole("heading", { name: "No pudimos cargar tus CVs" });
    expect(title.closest('[data-slot="card"]')?.querySelector('[data-slot="empty-icon"]')).not.toBeNull();
    expect(screen.getByRole(reason === "unauthenticated" ? "link" : "button", { name: reason === "unauthenticated" ? "Iniciar sesión" : "Reintentar" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Ir al panel" })).toHaveAttribute("href", "/candidato");
    expect(loadCvsAction).toHaveBeenCalledTimes(1);
  });
  it("keeps errors persistent, and allows explicit load retry", async () => {
    vi.mocked(loadCvsAction).mockResolvedValueOnce({ ok: false, reason: "no_response", reference: {} });
    render(<CvWorkspace />); expect(await screen.findByRole("heading", { name: "No pudimos cargar tus CVs" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByRole("heading", { name: /^Biblioteca/ })).toBeInTheDocument();
    expect(panel()).toHaveAccessibleName(cv.name);
  });
  it("shows storage unavailable with explicit retry and no automatic requests", async () => {
    vi.mocked(loadCvsAction).mockResolvedValueOnce({ ok: false, reason: "storage_unavailable", reference: { status: 503, code: "cv_storage_unavailable" } });
    render(<CvWorkspace />);
    expect(await screen.findByRole("heading", { name: unavailableTitle })).toBeVisible();
    expect(screen.getByText(unavailableDescription)).toBeVisible();
    expect(screen.getByRole("heading", { name: unavailableTitle }).closest('[data-slot="empty-title"]')).toHaveClass("text-xl", "font-semibold");
    expect(screen.getByRole("button", { name: "Reintentar" })).toHaveClass("w-full", "sm:w-auto");
    expect(loadCvsAction).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByRole("heading", { name: /^Biblioteca/ })).toBeVisible();
    expect(loadCvsAction).toHaveBeenCalledTimes(2);
  });
  it.each(["read", "upload"] as const)("shows the existing company-account state after %s wrong_role", async source => {
    if (source === "read") vi.mocked(loadCvsAction).mockResolvedValue({ ok: false, reason: "wrong_role", reference: { status: 403, code: "wrong_role" } });
    else { await ready(); fetchMock.mockResolvedValue(Response.json({ error: "private", code: "wrong_role" }, { status: 403 })); selectFile(new File(["pdf"], "cv.pdf", { type: "application/pdf" })); }
    if (source === "read") render(<CvWorkspace />);
    expect(await screen.findByRole("heading", { name: "Esta cuenta es de empresa" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Ir a empresa" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Cerrar sesión" })).toBeVisible();
  });
  it("offers «Iniciar sesión» in the status line when the session expires during an upload", async () => {
    await ready(); fetchMock.mockResolvedValue(Response.json({ error: "private", code: "unauthenticated" }, { status: 401 }));
    selectFile(new File(["pdf"], "cv.pdf", { type: "application/pdf" }));
    expect(await screen.findByRole("link", { name: "Iniciar sesión" })).toHaveAttribute("href", "/candidato/login");
    expect(screen.getByRole("status")).toHaveTextContent("Tu sesión expiró");
  });
});
