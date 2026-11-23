import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { listDocumentVersionsAction, loadDocumentOverviewAction } from "../actions";
import { itemSchema, overviewSchema, versionHistorySchema, type DocumentOverview } from "../model";
import { ids, itemWire, overviewWire, scopeWire, versionsWire } from "../test-fixtures";
import { replaceDocumentFile } from "./upload-client";
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
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.mocked(listDocumentVersionsAction).mockResolvedValue({ ok: true, data: versionHistorySchema.parse(versionsWire()) });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

type Wire = ReturnType<typeof overviewWire>;
const wire = (patch: (value: Wire) => void = () => {}): DocumentOverview => { const value = overviewWire(); patch(value); return overviewSchema.parse(value); };
const load = vi.mocked(loadDocumentOverviewAction);
const replace = vi.mocked(replaceDocumentFile);
const pdf = (name = "Nueva.pdf") => new File([new Uint8Array(512)], name, { type: "application/pdf" });
const mount = async (overview = wire()) => {
  load.mockResolvedValue({ ok: true, data: overview });
  render(<VacancyDocumentsTab draftId={ids.draft} />);
  await screen.findByRole("table");
};
const openVersions = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole("button", { name: "2 versiones" }));
  return screen.findByRole("dialog", { name: "Contrato firmado" });
};

describe("history (S5)", () => {
  it("lists every version, newest first, marks the current one and links each to its own download", async () => {
    const user = userEvent.setup();
    await mount();
    const sheet = await openVersions(user);
    expect(listDocumentVersionsAction).toHaveBeenCalledExactlyOnceWith({ draftId: ids.draft, participationId: ids.participation, documentId: ids.document });
    const versions = await within(sheet).findAllByRole("listitem");
    expect(versions).toHaveLength(2);
    expect(versions[0]).toHaveTextContent("Versión 2");
    expect(within(versions[0]).getByText("Vigente")).toBeVisible();
    expect(versions[1]).toHaveTextContent("Versión 1");
    expect(versions[1]).toHaveTextContent("Word · 88 KB");
    expect(within(versions[1]).getByRole("link", { name: "Descargar la versión 1" })).toHaveAttribute("href", `/api/company/job-drafts/${ids.draft}/participations/${ids.participation}/documents/${ids.document}/versions/1/file`);
  });
  it("offers no new-version form without «replace» but keeps the downloads", async () => {
    const user = userEvent.setup();
    await mount(wire(value => { value.items[0].allowed_actions = ["download"]; }));
    const sheet = await openVersions(user);
    await within(sheet).findAllByRole("listitem");
    expect(within(sheet).queryByLabelText("Archivo")).toBeNull();
    expect(within(sheet).getAllByRole("link", { name: /^Descargar la versión/ })).toHaveLength(2);
  });
  it("does not offer a new version at limits.max_versions and says so", async () => {
    const user = userEvent.setup();
    await mount(wire(value => { value.scope = scopeWire({ limits: { max_bytes: 10485760, max_documents: 50, max_versions: 2, formats: overviewWire().scope.limits.formats } }) as never; }));
    const sheet = await openVersions(user);
    expect(within(sheet).queryByLabelText("Archivo")).toBeNull();
    expect(within(sheet).getByText("No disponible: llegó a 2 de 2 versiones.")).toBeVisible();
  });
  it("shows a history failure with a retry", async () => {
    const user = userEvent.setup();
    await mount();
    vi.mocked(listDocumentVersionsAction).mockResolvedValueOnce({ ok: false, reason: "not_found", message: "No encontramos este documento o ya no tienes acceso.", reference: { status: 404 } });
    const sheet = await openVersions(user);
    expect(await within(sheet).findByText("No encontramos este documento o ya no tienes acceso.")).toBeVisible();
    await user.click(within(sheet).getByRole("button", { name: "Reintentar" }));
    expect(await within(sheet).findAllByRole("listitem")).toHaveLength(2);
  });
});

describe("new version (S5)", () => {
  const newer = (version: number) => ({ item: itemSchema.parse(itemWire({ participation_id: ids.participation, name: "Contrato firmado", version, version_count: version })), scope: overviewSchema.parse(overviewWire()).scope });
  it("«Nueva versión» in the row menu opens the form; it sends the version the person saw", async () => {
    const user = userEvent.setup();
    await mount();
    replace.mockResolvedValue({ ok: true, data: newer(3) });
    await user.click(within(screen.getByRole("row", { name: /Contrato firmado/ })).getByRole("button", { name: /Más acciones/ }));
    await user.click(await screen.findByRole("menuitem", { name: "Nueva versión" }));
    const sheet = await screen.findByRole("dialog", { name: "Contrato firmado" });
    await user.upload(within(sheet).getByLabelText("Archivo"), pdf());
    await user.click(within(sheet).getByRole("button", { name: "Subir como versión 3" }));
    expect(replace).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ draftId: ids.draft, participationId: ids.participation, documentId: ids.document, expectedVersion: 2, file: expect.any(File) }));
    await waitFor(() => expect(within(screen.getByRole("row", { name: /Contrato firmado/, hidden: true })).getByText("v3")).toBeInTheDocument());
    expect(load).toHaveBeenCalledTimes(1);
  });
  it("explains a version conflict, reloads the list and offers the new version number", async () => {
    const user = userEvent.setup();
    await mount();
    replace.mockResolvedValue({ ok: false, reason: "document_version_conflict", message: "Otra persona reemplazó este documento y ahora está en la versión 3. Actualizamos la lista; revisa y vuelve a intentarlo.", reference: { status: 409, code: "document_version_conflict" }, reload: true, currentVersion: 3 });
    load.mockResolvedValueOnce({ ok: true, data: wire(value => { Object.assign(value.items[0], itemWire({ participation_id: ids.participation, name: "Contrato firmado", version: 3, version_count: 3 })); }) });
    const sheet = await openVersions(user);
    await user.upload(await within(sheet).findByLabelText("Archivo"), pdf());
    await user.click(within(sheet).getByRole("button", { name: "Subir como versión 3" }));
    expect(await within(sheet).findByText(/Otra persona reemplazó este documento y ahora está en la versión 3/)).toBeVisible();
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    expect(await within(sheet).findByRole("button", { name: "Subir como versión 4" })).toBeInTheDocument();
  });
});
