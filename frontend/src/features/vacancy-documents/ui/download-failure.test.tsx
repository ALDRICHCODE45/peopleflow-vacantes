import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { loadDocumentOverviewAction } from "../actions";
import { overviewSchema, versionHistorySchema } from "../model";
import { ids, overviewWire, versionsWire } from "../test-fixtures";
import { notifyActionResult } from "@/components/feedback/notify";
import { VacancyDocumentsTab } from "./vacancy-documents-tab";

vi.mock("../actions", () => ({
  loadDocumentOverviewAction: vi.fn(), deleteDocumentAction: vi.fn(), deleteDocumentLinkAction: vi.fn(),
  listDocumentVersionsAction: vi.fn(), listDocumentSourcesAction: vi.fn(), createDocumentLinkAction: vi.fn(),
}));
vi.mock("@/components/feedback/notify", () => ({ notifyActionResult: vi.fn() }));
vi.mock("@/components/ui/combobox", async () => (await import("./test-support")).comboboxDouble());
vi.mock("@/components/ui/dropdown-menu", async () => (await import("./test-support")).dropdownMenuDouble());
const PATH = `/empresa/vacantes/${ids.draft}/documentos`;
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, media: "", addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn() })));
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.mocked(loadDocumentOverviewAction).mockResolvedValue({ ok: true, data: overviewSchema.parse(overviewWire()) });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.history.replaceState(null, "", "/"); });
const arrive = (search: string) => window.history.replaceState(null, "", `${PATH}${search}`);

describe("a download that failed on the server (the BFF sent the browser back with ?download_error=<code>)", () => {
  it("says why with the Spanish failure copy, as an error toast, and clears the parameter", async () => {
    arrive("?download_error=not_found");
    render(<VacancyDocumentsTab draftId={ids.draft} />);
    await screen.findByRole("table");
    expect(notifyActionResult).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      type: "error", title: "No se pudo descargar el documento", description: "No encontramos este documento o ya no tienes acceso.", reference: { code: "not_found" },
    }));
    expect(window.location.pathname + window.location.search).toBe(PATH);
  });
  it("uses the storage-off copy for document_storage_unavailable and keeps the other query parameters", async () => {
    arrive("?download_error=document_storage_unavailable&tab=x");
    render(<VacancyDocumentsTab draftId={ids.draft} />);
    await screen.findByRole("table");
    expect(notifyActionResult).toHaveBeenCalledWith(expect.objectContaining({ description: "El almacenamiento de documentos no está disponible por ahora. Vuelve a intentarlo en unos minutos." }));
    expect(window.location.search).toBe("?tab=x");
  });
  it("shows it even while the table is still loading", () => {
    vi.mocked(loadDocumentOverviewAction).mockReturnValue(new Promise(() => {}));
    arrive("?download_error=forbidden");
    render(<VacancyDocumentsTab draftId={ids.draft} />);
    expect(notifyActionResult).toHaveBeenCalledWith(expect.objectContaining({ type: "error", description: "No tienes permiso para descargar este documento." }));
  });
  it.each(["nope", "", "document_limit_reached", "__proto__"])("ignores an unknown code %j (nothing is shown, the parameter is still cleared)", async code => {
    arrive(`?download_error=${code}`);
    render(<VacancyDocumentsTab draftId={ids.draft} />);
    await screen.findByRole("table");
    expect(notifyActionResult).not.toHaveBeenCalled();
    expect(window.location.search).toBe("");
  });
  it("says nothing on a normal visit", async () => {
    arrive("");
    render(<VacancyDocumentsTab draftId={ids.draft} />);
    await screen.findByRole("table");
    expect(notifyActionResult).not.toHaveBeenCalled();
  });
});

describe("download links navigate to the BFF route (no `download` attribute: a failure must not be saved as a file)", () => {
  it("rows link to the file route without the download attribute", async () => {
    render(<VacancyDocumentsTab draftId={ids.draft} />);
    const row = await screen.findByRole("row", { name: /Contrato firmado/ });
    const link = within(row).getByRole("link", { name: /Descargar Contrato firmado/ });
    expect(link).toHaveAttribute("href", `/api/company/job-drafts/${ids.draft}/participations/${ids.participation}/documents/${ids.document}/file`);
    expect(link).not.toHaveAttribute("download");
    await waitFor(() => expect(link).toBeVisible());
  });
  it("version rows link to the version route without the download attribute", async () => {
    const { listDocumentVersionsAction } = await import("../actions");
    vi.mocked(listDocumentVersionsAction).mockResolvedValue({ ok: true, data: versionHistorySchema.parse(versionsWire()) });
    const user = (await import("@testing-library/user-event")).default.setup();
    render(<VacancyDocumentsTab draftId={ids.draft} />);
    await user.click(await screen.findByRole("button", { name: "2 versiones" }));
    const sheet = await screen.findByRole("dialog", { name: "Contrato firmado" });
    const link = await within(sheet).findByRole("link", { name: "Descargar la versión 1" });
    expect(link).not.toHaveAttribute("download");
  });
});
