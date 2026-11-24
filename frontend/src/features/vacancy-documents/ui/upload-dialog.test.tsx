import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { loadDocumentOverviewAction } from "../actions";
import { overviewSchema, itemSchema, type DocumentOverview } from "../model";
import { ids, itemWire, overviewWire, scopeWire } from "../test-fixtures";
import { uploadDocumentFile } from "./upload-client";
import { VacancyDocumentsTab } from "./vacancy-documents-tab";

vi.mock("../actions", () => ({
  loadDocumentOverviewAction: vi.fn(), deleteDocumentAction: vi.fn(), deleteDocumentLinkAction: vi.fn(),
  listDocumentVersionsAction: vi.fn(), listDocumentSourcesAction: vi.fn(), createDocumentLinkAction: vi.fn(),
}));
vi.mock("./upload-client", () => ({ uploadDocumentFile: vi.fn(), replaceDocumentFile: vi.fn() }));
vi.mock("@/components/feedback/notify", () => ({ notifyActionResult: vi.fn() }));
vi.mock("@/components/ui/combobox", async () => (await import("./test-support")).comboboxDouble());
vi.mock("@/components/ui/dropdown-menu", async () => (await import("./test-support")).dropdownMenuDouble());
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, media: "", addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn() })));
  vi.stubGlobal("PointerEvent", MouseEvent); // Base UI radios read it; jsdom has none
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

type Wire = ReturnType<typeof overviewWire>;
const wire = (patch: (value: Wire) => void = () => {}): DocumentOverview => { const value = overviewWire(); patch(value); return overviewSchema.parse(value); };
const upload = vi.mocked(uploadDocumentFile);
const pdf = (name = "Oferta.pdf", size = 2048) => new File([new Uint8Array(size)], name, { type: "application/pdf" });
const open = async (overview = wire(), user = userEvent.setup()) => {
  vi.mocked(loadDocumentOverviewAction).mockResolvedValue({ ok: true, data: overview });
  render(<VacancyDocumentsTab draftId={ids.draft} />);
  await user.click(await screen.findByRole("button", { name: "Subir documento" }));
  return { user, dialog: await screen.findByRole("dialog", { name: "Subir documento" }) };
};
const created = (over: Record<string, unknown> = {}) => ({ item: itemSchema.parse(itemWire({ id: ids.document2, name: "Oferta", version: 1, version_count: 1, ...over })), scope: overviewSchema.parse(overviewWire()).scope });

describe("destination (S3)", () => {
  it("asks who it belongs to: the vacancy, or a participation that allows uploads, with the reason when one is blocked", async () => {
    const { user, dialog } = await open();
    expect(within(dialog).getByRole("radio", { name: /La vacante/ })).toBeChecked();
    fireEvent.click(within(dialog).getByRole("radio", { name: /Una persona candidata/ }));
    await user.click(within(dialog).getByRole("combobox", { name: "Candidato" }));
    expect(screen.getByRole("option", { name: /Marta Ruiz/ })).not.toHaveAttribute("aria-disabled");
    const zoe = screen.getByRole("option", { name: /Zoe Zapata/ });
    expect(zoe).toHaveAttribute("aria-disabled", "true");
    await user.click(zoe);
    expect(within(dialog).queryByText(/llegó al límite/i)).toBeNull();
  });
  it("disables the vacancy when its scope blocks uploads, saying why, and falls back to a person", async () => {
    const overview = wire(value => { value.scope = scopeWire({ allowed_actions: ["link"], upload_blocked_reason: "limit_reached" }) as never; });
    const { dialog } = await open(overview);
    expect(within(dialog).getByRole("radio", { name: /La vacante/ })).toHaveAttribute("aria-disabled", "true");
    expect(within(dialog).getByText("Esta vacante llegó al límite de 50 documentos (archivos y vínculos). Elimina uno para subir otro.")).toBeVisible();
    expect(within(dialog).getByRole("radio", { name: /Una persona candidata/ })).toBeChecked();
  });
});

describe("shared choice and file controls (S1, S2, S6)", () => {
  it("offers the destination as a named radiogroup of rows with their description, not bare radios", async () => {
    const { dialog } = await open();
    const group = within(dialog).getByRole("radiogroup", { name: "¿A quién pertenece?" });
    expect(within(group).getAllByRole("radio")).toHaveLength(2);
    expect(within(group).getByText("Contratos, tabuladores y solicitudes del cliente")).toBeVisible();
    expect(within(dialog).getByRole("radio", { name: "La vacante" })).toHaveAccessibleDescription("Contratos, tabuladores y solicitudes del cliente");
  });
  it("shows the chosen file as a card with its format and size, and «Quitar» empties the field and blocks sending", async () => {
    const { user, dialog } = await open();
    expect(within(dialog).getByRole("button", { name: "Elegir archivo" })).toBeVisible();
    await user.upload(within(dialog).getByLabelText("Archivo"), pdf("Oferta.pdf", 2048));
    const card = within(dialog).getByRole("group", { name: "Archivo elegido" });
    expect(within(card).getByText("Oferta.pdf")).toBeVisible();
    expect(within(card).getByText("PDF · 2 KB")).toBeVisible();
    expect(card.querySelector("[data-pf-format=pdf]")).not.toBeNull();
    expect(within(dialog).getByRole("button", { name: "Subir" })).toBeEnabled();
    await user.click(within(card).getByRole("button", { name: "Quitar" }));
    expect(within(dialog).queryByRole("group", { name: "Archivo elegido" })).toBeNull();
    expect(within(dialog).getByRole("button", { name: "Subir" })).toBeDisabled();
  });
  it("keeps a rejected file on screen next to its error so it can be changed", async () => {
    const overview = wire(value => { value.scope = scopeWire({ limits: { max_bytes: 4096, max_documents: 50, max_versions: 25, formats: overviewWire().scope.limits.formats } }) as never; });
    const { user, dialog } = await open(overview);
    await user.upload(within(dialog).getByLabelText("Archivo"), pdf("Grande.pdf", 5000));
    expect(within(within(dialog).getByRole("group", { name: "Archivo elegido" })).getByRole("button", { name: "Cambiar" })).toBeVisible();
    expect(within(dialog).getByRole("alert")).toHaveTextContent("Grande.pdf pesa 5 KB y el máximo es 4 KB.");
  });
});

describe("destination from the filter", () => {
  it("preselects the candidate the table is filtered by", async () => {
    const user = userEvent.setup();
    vi.mocked(loadDocumentOverviewAction).mockResolvedValue({ ok: true, data: wire() });
    render(<VacancyDocumentsTab draftId={ids.draft} />);
    await user.click(await screen.findByRole("combobox", { name: "Candidato" }));
    await user.click(await screen.findByRole("option", { name: /Marta Ruiz/ }));
    await user.click(await screen.findByRole("button", { name: "Subir documento" }));
    const dialog = await screen.findByRole("dialog", { name: "Subir documento" });
    expect(within(dialog).getByRole("radio", { name: /Una persona candidata/ })).toBeChecked();
    expect(within(dialog).getByRole("combobox", { name: "Candidato" })).toHaveValue("Marta Ruiz");
  });
});

describe("file pre-check from limits (S1, S4)", () => {
  it("accepts exactly the extensions in limits.formats", async () => {
    const { dialog } = await open();
    expect(within(dialog).getByLabelText("Archivo")).toHaveAttribute("accept", ".pdf,.docx,.xlsx,.jpg,.jpeg,.png");
  });
  it("rejects a file over limits.max_bytes without sending it, with the live number", async () => {
    const overview = wire(value => { value.scope = scopeWire({ limits: { max_bytes: 4096, max_documents: 50, max_versions: 25, formats: overviewWire().scope.limits.formats } }) as never; });
    const { user, dialog } = await open(overview);
    await user.upload(within(dialog).getByLabelText("Archivo"), pdf("Grande.pdf", 5000));
    expect(await within(dialog).findByText("Grande.pdf pesa 5 KB y el máximo es 4 KB.")).toBeVisible();
    expect(within(dialog).getByRole("button", { name: "Subir" })).toBeDisabled();
    expect(upload).not.toHaveBeenCalled();
  });
  it("rejects a format that limits.formats does not list, naming the allowed ones", async () => {
    const user = userEvent.setup({ applyAccept: false });
    const { dialog } = await open(wire(), user);
    await user.upload(within(dialog).getByLabelText("Archivo"), new File(["x"], "Contrato anterior.doc", { type: "application/msword" }));
    expect(await within(dialog).findByText(/No aceptamos archivos \.doc\./)).toHaveTextContent("PDF (.pdf), Word (.docx), Excel (.xlsx), JPG (.jpg, .jpeg), PNG (.png)");
    expect(within(dialog).getByRole("button", { name: "Subir" })).toBeDisabled();
  });
});

describe("sending", () => {
  it("uploads to the chosen scope with an Idempotency-Key, shows progress, then adds the row from the response's scope without a re-read", async () => {
    let progress: (fraction: number) => void = () => {};
    let finish: (value: Awaited<ReturnType<typeof uploadDocumentFile>>) => void = () => {};
    upload.mockImplementation(input => { progress = input.onProgress!; return new Promise(resolve => { finish = resolve; }); });
    const { user, dialog } = await open();
    await user.upload(within(dialog).getByLabelText("Archivo"), pdf());
    await user.click(within(dialog).getByRole("button", { name: "Subir" }));
    expect(upload).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ draftId: ids.draft, participationId: null, idempotencyKey: expect.stringMatching(/^[0-9a-f-]{36}$/), file: expect.any(File) }));
    progress(0.62);
    expect(await within(dialog).findByRole("progressbar")).toHaveAttribute("aria-valuenow", "62");
    finish({ ok: true, data: created() });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Subir documento" })).toBeNull());
    expect(screen.getByRole("row", { name: /Oferta/ })).toBeVisible();
    expect(vi.mocked(loadDocumentOverviewAction)).toHaveBeenCalledTimes(1);
  });
  it("reuses the same Idempotency-Key when the same file is retried and makes a new one for another file", async () => {
    upload.mockResolvedValue({ ok: false, reason: "no_response", message: "No pudimos confirmar la operación. Actualiza la lista para ver si se aplicó antes de volver a intentarlo.", reference: {}, uncertain: true });
    const { user, dialog } = await open();
    const input = within(dialog).getByLabelText("Archivo");
    await user.upload(input, pdf());
    await user.click(within(dialog).getByRole("button", { name: "Subir" }));
    await within(dialog).findByText(/No pudimos confirmar la operación/);
    await user.click(within(dialog).getByRole("button", { name: "Subir" }));
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(2));
    expect(upload.mock.calls[1][0].idempotencyKey).toBe(upload.mock.calls[0][0].idempotencyKey);
    await user.upload(input, pdf("Otra.pdf"));
    await user.click(within(dialog).getByRole("button", { name: "Subir" }));
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(3));
    expect(upload.mock.calls[2][0].idempotencyKey).not.toBe(upload.mock.calls[0][0].idempotencyKey);
  });
  it("shows a server rejection of the file next to the file field and keeps the dialog open", async () => {
    upload.mockResolvedValue({ ok: false, reason: "document_content_mismatch", message: "El contenido del archivo no coincide con su extensión (.pdf): parece un archivo DOCX. Cambia la extensión o elige otro archivo.", reference: { status: 400 }, fields: { file: "El archivo está vacío. Elige otro." } });
    const { user, dialog } = await open();
    await user.upload(within(dialog).getByLabelText("Archivo"), pdf());
    await user.click(within(dialog).getByRole("button", { name: "Subir" }));
    expect(await within(dialog).findByText("El archivo está vacío. Elige otro.")).toBeVisible();
    expect(within(dialog).getByLabelText("Archivo")).toHaveAttribute("aria-invalid", "true");
  });
  it("reads the overview again when the server says the scope moved (limit reached)", async () => {
    upload.mockResolvedValue({ ok: false, reason: "document_limit_reached", message: "Este espacio ya tiene 50 documentos, que es el máximo. Elimina o desvincula alguno para continuar.", reference: { status: 409 }, reload: true });
    const { user, dialog } = await open();
    await user.upload(within(dialog).getByLabelText("Archivo"), pdf());
    await user.click(within(dialog).getByRole("button", { name: "Subir" }));
    expect(await within(dialog).findByText(/ya tiene 50 documentos/)).toBeVisible();
    await waitFor(() => expect(vi.mocked(loadDocumentOverviewAction)).toHaveBeenCalledTimes(2));
  });
});
