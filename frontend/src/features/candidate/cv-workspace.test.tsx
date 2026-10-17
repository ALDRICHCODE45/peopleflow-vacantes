import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
vi.mock("@/features/candidate-cvs/actions", () => ({ loadCvsAction: vi.fn(), renameCvAction: vi.fn(), deleteCvAction: vi.fn() }));
vi.mock("@/components/feedback/notify", () => ({ notifyActionResult: vi.fn() }));
import { loadCvsAction } from "@/features/candidate-cvs/actions";
import { notifyActionResult } from "@/components/feedback/notify";
import { cv, library } from "@/features/candidate-cvs/test-fixtures";
import { CvWorkspace } from "./cv-workspace";
const fetchMock = vi.fn();
beforeEach(() => {
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("fetch", fetchMock); fetchMock.mockReset(); vi.mocked(notifyActionResult).mockReset();
  vi.mocked(loadCvsAction).mockReset().mockResolvedValue({ ok: true, data: library });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
async function ready() { const rendered = render(<CvWorkspace />); await screen.findByRole("heading", { name: cv.name }); return rendered; }
function selectFile(file: File) { fireEvent.change(screen.getByLabelText("Archivo del CV"), { target: { files: [file] } }); }
const unavailableTitle = "Los CVs no están disponibles en este momento";
const unavailableDescription = "Puedes intentarlo más tarde; lo que ya escribiste se conserva.";
describe("real CV workspace", () => {
  it("shows storage unavailable with explicit retry and no automatic requests", async () => {
    vi.mocked(loadCvsAction).mockResolvedValueOnce({ ok: false, reason: "storage_unavailable", reference: { status: 503, code: "cv_storage_unavailable" } });
    render(<CvWorkspace />);
    expect(await screen.findByRole("heading", { name: unavailableTitle })).toBeVisible();
    expect(screen.getByText(unavailableDescription)).toBeVisible();
    expect(loadCvsAction).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByRole("heading", { name: cv.name })).toBeVisible();
    expect(loadCvsAction).toHaveBeenCalledTimes(2);
  });
  it("retains the library and gives the storage copy in upload toast and ActionStatus", async () => {
    await ready(); fetchMock.mockResolvedValue(Response.json({ error: "private", code: "cv_storage_unavailable" }, { status: 503 }));
    selectFile(new File(["pdf"], "cv.pdf", { type: "application/pdf" }));
    await waitFor(() => expect(notifyActionResult).toHaveBeenCalledWith(expect.objectContaining({ type: "error", title: unavailableTitle, description: unavailableDescription })));
    expect(screen.getByRole("status")).toHaveTextContent(unavailableTitle);
    expect(screen.getByRole("status")).toHaveTextContent(unavailableDescription);
    expect(screen.getByRole("heading", { name: cv.name })).toBeVisible();
    expect(screen.getByRole("button", { name: "Reintentar" })).toBeVisible();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it.each(["read", "upload"] as const)("shows the existing company-account state after %s wrong_role", async source => {
    if (source === "read") vi.mocked(loadCvsAction).mockResolvedValue({ ok: false, reason: "wrong_role", reference: { status: 403, code: "wrong_role" } });
    else { await ready(); fetchMock.mockResolvedValue(Response.json({ error: "private", code: "wrong_role" }, { status: 403 })); selectFile(new File(["pdf"], "cv.pdf", { type: "application/pdf" })); }
    if (source === "read") render(<CvWorkspace />);
    expect(await screen.findByRole("heading", { name: "Esta cuenta es de empresa" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Ir a empresa" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Cerrar sesión" })).toBeVisible();
  });
  it("shows a structural skeleton while the action is pending", () => {
    vi.mocked(loadCvsAction).mockReturnValue(new Promise(() => {}));
    const { container } = render(<CvWorkspace />);
    expect(screen.getByRole("status")).toHaveTextContent("Cargando CVs");
    expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(1);
    expect(screen.queryByText("Sin CVs")).toBeNull();
  });
  it("renders the empty state and the server limit counter", async () => {
    vi.mocked(loadCvsAction).mockResolvedValue({ ok: true, data: { ...library, items: [] } });
    render(<CvWorkspace />);
    expect(await screen.findByText("Sin CVs")).toBeInTheDocument();
    expect(screen.getByText("0 de 10 CVs")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Subir CV" })).toBeEnabled();
  });
  it("shows actual name, type, size, es-MX date and neutral in-use badge in the approved cards", async () => {
    const { container } = await ready();
    const card = container.querySelector('[data-pf-cv-card]')!;
    for (const text of ["PDF", "340 KB", "10 de marzo de 2026", "En uso"]) expect(card).toHaveTextContent(text);
    expect(screen.getByText("En uso")).toHaveAttribute("data-variant", "neutral");
    expect(screen.getByText("1 de 10 CVs")).toBeInTheDocument();
    const trigger = screen.getByRole("button", { name: `Acciones de ${cv.name}` });
    expect(trigger).toHaveAttribute("aria-haspopup", "menu"); expect(trigger.className).toContain("size-10");
    expect(trigger.closest('[data-slot="card-action"]')).not.toBeNull();
    expect(card.querySelector('[data-slot="card-footer"]')).toBeNull();
  });
  it("shows Word without fabricating primary-role or language data", async () => {
    vi.mocked(loadCvsAction).mockResolvedValue({ ok: true, data: { ...library, items: [{ ...cv, in_use: false, content_type: library.limits.content_types[1] as "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }] } });
    render(<CvWorkspace />); expect(await screen.findByText("Word")).toBeInTheDocument();
    expect(screen.queryByText("En uso")).toBeNull(); expect(screen.queryByText("Principal")).toBeNull();
  });
  it("keeps errors persistent, and allows explicit load retry", async () => {
    vi.mocked(loadCvsAction).mockResolvedValueOnce({ ok: false, reason: "unauthenticated", reference: { status: 401 } });
    render(<CvWorkspace />); expect(await screen.findByText("Tu sesión expiró")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Iniciar sesión" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByRole("heading", { name: cv.name })).toBeInTheDocument();
  });
  it.each([
    [new File(["x"], "cv.exe", { type: "application/octet-stream" }), "Sube un PDF o un documento de Word (.docx)."],
    [new File([new Uint8Array(5242881)], "cv.pdf", { type: "application/pdf" }), "El archivo pesa más de 5 MB."],
  ])("checks the file before any browser request", async (file, message) => {
    await ready(); selectFile(file);
    expect(await screen.findByText(message)).toBeInTheDocument(); expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Archivo del CV")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Archivo del CV")).toHaveFocus();
  });
  it("uploads once to the same-origin route, shows Spinner and confirmed success", async () => {
    await ready(); let resolve!: (value: Response) => void;
    fetchMock.mockReturnValue(new Promise<Response>(done => { resolve = done; }));
    selectFile(new File(["%PDF-"], "cv.pdf", { type: "application/pdf" }));
    expect(await screen.findByRole("button", { name: "Subiendo…" })).toBeDisabled();
    expect(document.querySelector('[data-slot="spinner"]')).not.toBeNull();
    expect(fetchMock.mock.calls[0][0]).toBe("/api/candidate/cvs");
    expect(fetchMock.mock.calls[0][1].body.getAll("file")).toHaveLength(1);
    resolve(Response.json({ ...cv, id: "b12b3456-1234-4234-8234-123456789abc" }, { status: 201 }));
    await waitFor(() => expect(notifyActionResult).toHaveBeenCalledWith(expect.objectContaining({ type: "success", title: "CV subido" })));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it.each([
    [400, "cv_content_mismatch", "El archivo no coincide con su formato. Expórtalo de nuevo como PDF o Word."],
    [409, "cv_library_full", "Ya tienes 10 CVs. Elimina uno para subir otro."],
  ])("maps upload failure %s %s", async (status, code, description) => {
    await ready(); fetchMock.mockResolvedValue(Response.json({ error: "private detail", code }, { status: Number(status) }));
    selectFile(new File(["%PDF-"], "cv.pdf", { type: "application/pdf" }));
    await waitFor(() => expect(notifyActionResult).toHaveBeenCalledWith(expect.objectContaining({ type: "error", description, reference: expect.objectContaining({ status, code }) })));
    expect(screen.getByRole("status")).not.toHaveTextContent("private detail");
    if (code === "cv_content_mismatch") expect(screen.getByLabelText("Archivo del CV")).toHaveFocus();
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
    expect(screen.getByRole("button", { name: "Subir CV" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Comprobar" }));
    await waitFor(() => expect(loadCvsAction).toHaveBeenCalledTimes(2));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("disables upload at the real limit with an associated explanation", async () => {
    vi.mocked(loadCvsAction).mockResolvedValue({ ok: true, data: { ...library, limits: { ...library.limits, max_cvs: 1 } } });
    await ready(); expect(screen.getByRole("button", { name: "Subir CV" })).toBeDisabled();
    expect(screen.getByText("Ya tienes 1 CVs. Elimina uno para subir otro.")).toBeInTheDocument();
  });
  it("keeps semantic paint and a responsive document grid", async () => {
    const { container } = await ready();
    expect(container.querySelector('[data-pf-cv-list]')?.className).toContain("lg:grid-cols-2");
    const source = readFileSync("src/features/candidate/cv-workspace.tsx", "utf8");
    expect(source).not.toMatch(/#[0-9a-f]{3,8}\b|(?:rgb|hsl|oklch|color-mix)\(|dark:|space-[xy]-|bg-card\/40/u);
    expect(container.querySelector('[data-pf-cv-workspace]')?.className).toContain("max-w-screen-2xl");
  });
});
