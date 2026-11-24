import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import {
  deleteDocumentAction, deleteDocumentLinkAction, loadDocumentOverviewAction,
} from "../actions";
import { overviewSchema, type DocumentOverview } from "../model";
import { ids, inaccessibleLinkWire, linkWire, overviewWire, scopeWire } from "../test-fixtures";
import { VacancyDocumentsTab } from "./vacancy-documents-tab";

vi.mock("../actions", () => ({
  loadDocumentOverviewAction: vi.fn(), deleteDocumentAction: vi.fn(), deleteDocumentLinkAction: vi.fn(),
  listDocumentVersionsAction: vi.fn(), listDocumentSourcesAction: vi.fn(), createDocumentLinkAction: vi.fn(),
}));
vi.mock("@/components/feedback/notify", () => ({ notifyActionResult: vi.fn() }));
// The Next router is what the tab reads `?candidato=` from; a test moves it by changing `routerSearch` and rendering again.
let routerSearch = "";
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(routerSearch) }));
vi.mock("@/components/ui/combobox", async () => (await import("./test-support")).comboboxDouble());
vi.mock("@/components/ui/dropdown-menu", async () => (await import("./test-support")).dropdownMenuDouble());
// jsdom has neither; the combobox and the sheet read them while they lay out.
beforeEach(() => {
  routerSearch = "";
  vi.resetAllMocks();
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, media: "", addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn() })));
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

type Wire = ReturnType<typeof overviewWire>;
const wire = (patch: (value: Wire) => void = () => {}): DocumentOverview => { const value = overviewWire(); patch(value); return overviewSchema.parse(value); };
const load = vi.mocked(loadDocumentOverviewAction);
const ready = (overview = wire()) => load.mockResolvedValue({ ok: true, data: overview });
const renderTab = async (overview = wire()) => {
  ready(overview);
  render(<VacancyDocumentsTab draftId={ids.draft} />);
  await screen.findByRole("table");
};
const row = (name: string | RegExp) => screen.getByRole("row", { name });
const failure = (reason: string) => ({ ok: false as const, reason, message: "No pudimos cargar los documentos.", reference: {} }) as never;

describe("candidate filter from ?candidato=", () => {
  afterEach(() => window.history.replaceState(null, "", "/"));
  const PATH = `/empresa/vacantes/${ids.draft}/documentos`;
  it("opens narrowed to the participation named by ?candidato=", async () => {
    routerSearch = `?candidato=${ids.participation}`;
    ready();
    render(<VacancyDocumentsTab draftId={ids.draft} />);
    await screen.findByRole("table");
    expect(load).toHaveBeenCalledWith(ids.draft, ids.participation);
  });
  it("applies ?candidato= when a client navigation adds it to a tab that is already mounted", async () => {
    ready();
    const { rerender } = render(<VacancyDocumentsTab draftId={ids.draft} />);
    await screen.findByRole("table");
    expect(load).toHaveBeenLastCalledWith(ids.draft, undefined);
    routerSearch = `?candidato=${ids.participation}`;
    rerender(<VacancyDocumentsTab draftId={ids.draft} />);
    await waitFor(() => expect(load).toHaveBeenLastCalledWith(ids.draft, ids.participation));
    expect(await screen.findByRole("group", { name: "Filtro activo" })).toBeVisible();
  });
  it("drops the filter when a navigation removes ?candidato=", async () => {
    routerSearch = `?candidato=${ids.participation}`;
    ready();
    const { rerender } = render(<VacancyDocumentsTab draftId={ids.draft} />);
    await screen.findByRole("table");
    routerSearch = "";
    rerender(<VacancyDocumentsTab draftId={ids.draft} />);
    await waitFor(() => expect(load).toHaveBeenLastCalledWith(ids.draft, undefined));
  });
  it("«Quitar filtro» removes ?candidato= from the address and keeps the other parameters", async () => {
    window.history.replaceState(null, "", `${PATH}?candidato=${ids.participation}&tab=x`);
    routerSearch = `?candidato=${ids.participation}&tab=x`;
    ready();
    render(<VacancyDocumentsTab draftId={ids.draft} />);
    await screen.findByRole("table");
    await userEvent.click(await screen.findByRole("button", { name: "Quitar filtro" }));
    await waitFor(() => expect(load).toHaveBeenLastCalledWith(ids.draft, undefined));
    expect(window.location.pathname + window.location.search).toBe(`${PATH}?tab=x`);
  });
});
describe("states", () => {
  it("shows a loading skeleton with no figures or actions while the overview loads", () => {
    load.mockReturnValue(new Promise(() => {}));
    render(<VacancyDocumentsTab draftId={ids.draft} />);
    expect(screen.getByRole("status", { name: "Cargando documentos" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Subir documento" })).toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
  });
  it("reads the vacancy overview once and shows an error with a retry", async () => {
    load.mockResolvedValueOnce(failure("no_response"));
    render(<VacancyDocumentsTab draftId={ids.draft} />);
    expect(await screen.findByText("No pudimos cargar los documentos.")).toBeVisible();
    ready();
    await userEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByRole("table")).toBeVisible();
    expect(load).toHaveBeenNthCalledWith(1, ids.draft, undefined);
    expect(load).toHaveBeenCalledTimes(2);
  });
  it("explains a vacancy without documents and offers the first upload only when the scope allows it", async () => {
    const empty = (actions: string[]) => wire(value => { value.items = []; value.links = []; value.scope = scopeWire({ allowed_actions: actions, counts: { documents: 0, links: 0 } }) as never; });
    ready(empty(["upload"]));
    const { unmount } = render(<VacancyDocumentsTab draftId={ids.draft} />);
    expect(await screen.findByRole("heading", { name: "Todavía no hay documentos en esta vacante" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Subir el primer documento" })).toBeVisible();
    unmount();
    ready(wire(value => { value.items = []; value.links = []; value.scope = scopeWire({ allowed_actions: [] }) as never; for (const entry of value.participations) entry.scope_allowed_actions = []; }));
    render(<VacancyDocumentsTab draftId={ids.draft} />);
    await screen.findByRole("heading", { name: "Todavía no hay documentos en esta vacante" });
    expect(screen.queryByRole("button", { name: /^Subir/ })).toBeNull();
  });
});

describe("table", () => {
  it("lists the name and format, who owns it, version, who updated it, when and the size", async () => {
    await renderTab(wire(value => { value.participations[0].discarded = true; ((value.items[0] as unknown as { owner: { discarded: boolean } }).owner).discarded = true; }));
    const signed = row(/Contrato firmado/);
    expect(within(signed).getByText("PDF · 179 KB")).toBeVisible();
    expect(within(signed).getByText("Marta Ruiz")).toBeVisible();
    expect(within(signed).getByText("Descartado")).toHaveAttribute("data-slot", "badge");
    expect(within(signed).getByText("v2")).toBeVisible();
    expect(within(signed).getByRole("button", { name: "2 versiones" })).toBeVisible();
    expect(within(signed).getByText("Luis Ortega")).toBeVisible();
    expect(within(signed).getByText("22 nov 2026")).toBeVisible();
    const marco = row(/Contrato marco/);
    expect(within(marco).getByText("Vacante")).toBeVisible();
    expect(within(marco).queryByRole("button", { name: /versiones/ })).toBeNull();
  });
  it("offers only the actions each item and link allow, with no role table of its own", async () => {
    const user = userEvent.setup();
    await renderTab(wire(value => {
      value.items[0].allowed_actions = ["download"];
      value.items[1].allowed_actions = ["download", "replace", "delete"];
      value.links = [{ ...linkWire({ allowed_actions: ["unlink"] }), owner: { kind: "vacancy" } }] as never;
    }));
    const signed = row(/Contrato firmado/);
    expect(within(signed).getByRole("link", { name: /Descargar Contrato firmado/ })).toHaveAttribute("href", `/api/company/job-drafts/${ids.draft}/participations/${ids.participation}/documents/${ids.document}/file`);
    expect(within(signed).queryByRole("button", { name: /Más acciones/ })).toBeNull();
    const marco = row(/Contrato marco/);
    expect(within(marco).getByRole("link", { name: /Descargar Contrato marco/ })).toHaveAttribute("href", `/api/company/job-drafts/${ids.draft}/documents/${ids.document2}/file`);
    await user.click(within(marco).getByRole("button", { name: /Más acciones de Contrato marco/ }));
    expect(await screen.findByRole("menuitem", { name: "Nueva versión" })).toBeVisible();
    expect(screen.getByRole("menuitem", { name: "Eliminar documento" })).toBeVisible();
    const linked = row(/Contrato original/);
    expect(within(linked).queryByRole("link", { name: /Descargar/ })).toBeNull();
    await user.click(within(linked).getByRole("button", { name: /Más acciones/ }));
    expect(await screen.findByRole("menuitem", { name: "Desvincular" })).toBeVisible();
  });
  it("is read-only when no item and no scope allows more than downloading", async () => {
    await renderTab(wire(value => {
      value.scope = scopeWire({ can_manage: false, allowed_actions: [] }) as never;
      for (const item of value.items) item.allowed_actions = ["download"];
      for (const link of value.links) link.allowed_actions = link.state === "available" ? ["download"] : [] as never;
      for (const entry of value.participations) entry.scope_allowed_actions = [];
    }));
    expect(screen.queryByRole("button", { name: "Subir documento" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Más acciones/ })).toBeNull();
    expect(screen.getAllByRole("link", { name: /^Descargar/ }).length).toBeGreaterThan(0);
  });
  it("shows link rows with origin, pinned version, newer-version notice and the removed and inaccessible states", async () => {
    await renderTab(wire(value => {
      value.links = [
        { ...linkWire(), owner: { kind: "vacancy" } },
        { ...linkWire({ id: ids.link2, source: { ...linkWire().source, document_id: ids.document, sequence: 2, name: "Perfil", has_newer_version: false, version: 3 } }), owner: { kind: "vacancy" } },
        { ...inaccessibleLinkWire(), id: "0193c0ee-0000-7000-8000-000000000053", owner: { kind: "vacancy" } },
        { ...linkWire({ id: "0193c0ee-0000-7000-8000-000000000054", state: "removed", allowed_actions: ["unlink"], source: null }), owner: { kind: "vacancy" } },
      ] as never;
    }));
    const original = row(/Contrato original/);
    expect(within(original).getByText("Proceso original")).toBeVisible();
    expect(within(original).getByText("v1 fijada")).toBeVisible();
    expect(within(original).getByText("Hay una versión más nueva")).toBeVisible();
    const replacement = row(/Perfil/);
    expect(within(replacement).getByText("Reemplazo 2")).toBeVisible();
    expect(within(replacement).getByText("v3 fijada")).toBeVisible();
    expect(within(replacement).queryByText("Hay una versión más nueva")).toBeNull();
    expect(within(replacement).getByRole("link", { name: /Descargar Perfil \(versión fijada\)/ })).toHaveAttribute("href", `/api/company/job-drafts/${ids.draft}/document-links/${ids.link2}/file`);
    expect(within(row(/Documento sin acceso/)).getByText("Sin acceso")).toBeVisible();
    expect(within(row(/Documento eliminado/)).getByText("Eliminado en el origen")).toBeVisible();
  });
  it("says the list is truncated and suggests filtering by candidate", async () => {
    await renderTab(wire(value => { value.truncated = true; }));
    expect(screen.getByText(/Se muestran los documentos más recientes/)).toHaveTextContent("Filtra por candidato para ver el resto");
    expect(screen.queryByText("Candidatos 2")).toBeNull();
  });
});

describe("T3e layout defects", () => {
  it("6: the «N versiones» button uses the AA text token of both themes, not --primary (2.16:1 on dark)", async () => {
    await renderTab();
    const button = within(row(/Contrato firmado/)).getByRole("button", { name: "2 versiones" });
    expect(button).toHaveClass("text-primary-text");
    expect(button).not.toHaveClass("text-primary");
  });
  it("7: on phones every row keeps its card border (the body's last-child reset cannot remove it), with the actions on the title row", async () => {
    await renderTab();
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows.length).toBeGreaterThan(1);
    for (const entry of rows) {
      expect(entry).toHaveClass("max-md:border!", "max-md:rounded-2xl");
      const [name, ...rest] = Array.from(entry.querySelectorAll(":scope > td"));
      const actions = rest.at(-1)!;
      // The name and the actions are the first row's two cells; the other cells span both columns under the name.
      expect(name).toHaveClass("max-md:col-start-1", "max-md:row-start-1");
      expect(name).not.toHaveClass("max-md:col-span-2");
      expect(actions).toHaveClass("max-md:col-start-2", "max-md:row-start-1");
      for (const detail of rest.slice(0, -1)) expect(detail).toHaveClass("max-md:col-span-2", "max-md:pl-11");
    }
  });
  it("11: rows show a format badge colored by its status token (PDF danger, Word info, Excel success, JPG/PNG review), not a generic file icon", async () => {
    await renderTab(wire(value => {
      const base = value.items[0];
      value.items = [{ ...base, format: "pdf" }, { ...value.items[1], format: "docx" }, { ...base, id: "0193c0ee-0000-7000-8000-0000000000a1", name: "Hoja", format: "xlsx" }, { ...base, id: "0193c0ee-0000-7000-8000-0000000000a2", name: "Foto", format: "jpg" }, { ...base, id: "0193c0ee-0000-7000-8000-0000000000a3", name: "Plano", format: "png" }] as never;
    }));
    const tone = (name: RegExp) => row(name).querySelector("[data-pf-format]")!;
    expect(tone(/Contrato firmado/)).toHaveTextContent("PDF");
    expect(tone(/Contrato firmado/)).toHaveClass("text-status-danger");
    expect(tone(/Contrato marco/)).toHaveTextContent("Word");
    expect(tone(/Contrato marco/)).toHaveClass("text-status-info");
    expect(tone(/Hoja/)).toHaveTextContent("Excel");
    expect(tone(/Hoja/)).toHaveClass("text-status-success");
    for (const name of [/Foto/, /Plano/]) expect(tone(name)).toHaveClass("text-status-review");
    expect(tone(/Foto/)).toHaveAttribute("aria-hidden", "true");
  });
  it("11: the upload and link actions share the heading row (they wrapped under the filters at 1440) and are one full-width column on phones", async () => {
    await renderTab(wire(value => { value.scope = scopeWire({ allowed_actions: ["upload", "link"] }) as never; }));
    const heading = screen.getByRole("heading", { level: 2, name: "Documentos" });
    const actions = document.querySelector("[data-pf-documents-actions]") as HTMLElement;
    expect(heading.parentElement).toContainElement(actions);
    expect(within(actions).getByRole("button", { name: "Subir documento" })).toBeVisible();
    expect(within(actions).getByRole("button", { name: "Vincular del proceso original" })).toBeVisible();
    expect(actions).toHaveClass("max-sm:w-full", "max-sm:flex-col");
    expect(screen.getByRole("group", { name: "Filtrar por ámbito" }).closest("div[class*=flex-col]")).not.toContainElement(actions);
  });
  it("11: at 390 the scope filter fills the row (no overflow) and the Candidato picker takes the full width like the search", async () => {
    await renderTab();
    const scope = screen.getByRole("group", { name: "Filtrar por ámbito" });
    expect(scope).toHaveClass("max-sm:w-full");
    for (const item of within(scope).getAllByRole("button")) expect(item).toHaveClass("max-sm:min-w-0", "max-sm:flex-1");
    expect(screen.getByRole("combobox", { name: "Candidato" }).closest("div.flex-col")).toHaveClass("max-sm:w-full");
    expect(screen.getByRole("searchbox", { name: "Buscar documento" }).parentElement).toHaveClass("max-sm:basis-full");
  });
  it("11: a candidate name wraps next to «Descartado» instead of truncating", async () => {
    const user = userEvent.setup();
    await renderTab();
    await user.click(screen.getByRole("combobox", { name: "Candidato" }));
    const zoe = await screen.findByRole("option", { name: /Zoe Zapata/ });
    expect(within(zoe).getByText("Zoe Zapata")).not.toHaveClass("truncate");
    expect(within(zoe).getByText("Zoe Zapata")).toHaveClass("[overflow-wrap:anywhere]");
    expect(within(zoe).getByText("Descartado")).toHaveClass("shrink-0");
  });
});

describe("filters (S13)", () => {
  it("counts the scopes from scope.counts and the rows", async () => {
    await renderTab();
    expect(screen.getByRole("button", { name: /Todos/ })).toHaveTextContent("Todos4");
    expect(screen.getByRole("button", { name: /^Vacante/ })).toHaveTextContent("Vacante2");
    expect(screen.getByRole("button", { name: /Candidatos/ })).toHaveTextContent("Candidatos2");
  });
  it("«Vacante» and «Candidatos» narrow the rows", async () => {
    const user = userEvent.setup();
    await renderTab();
    await user.click(screen.getByRole("button", { name: /^Vacante/ }));
    expect(screen.queryByRole("row", { name: /Contrato firmado/ })).toBeNull();
    expect(row(/Contrato marco/)).toBeVisible();
    await user.click(screen.getByRole("button", { name: /Candidatos/ }));
    expect(screen.queryByRole("row", { name: /Contrato marco/ })).toBeNull();
    expect(row(/Contrato firmado/)).toBeVisible();
  });
  it("choosing a candidate reads that person's rows, sets «Candidatos» and shows the chip; «Vacante» disables and clears the selector", async () => {
    const user = userEvent.setup();
    await renderTab();
    load.mockResolvedValue({ ok: true, data: wire(value => { value.items = [value.items[0]]; value.links = []; }) });
    await user.click(screen.getByRole("combobox", { name: "Candidato" }));
    await user.click(await screen.findByRole("option", { name: /Marta Ruiz/ }));
    await waitFor(() => expect(load).toHaveBeenLastCalledWith(ids.draft, ids.participation));
    expect(screen.getByRole("button", { name: /Candidatos/ })).toHaveAttribute("aria-pressed", "true");
    const chip = screen.getByRole("group", { name: "Filtro activo" });
    expect(within(chip).getByText("Marta Ruiz")).toBeVisible();
    await user.click(screen.getByRole("button", { name: /^Vacante/ }));
    const selector = screen.getByRole("combobox", { name: "Candidato" });
    expect(selector).toBeDisabled();
    expect(selector).toHaveAttribute("placeholder", "No aplica a la vacante");
    expect(selector).toHaveValue("");
    expect(screen.queryByRole("group", { name: "Filtro activo" })).toBeNull();
    await waitFor(() => expect(load).toHaveBeenLastCalledWith(ids.draft, undefined));
  });
  it("«Quitar filtro» drops the candidate and reads the whole vacancy again", async () => {
    const user = userEvent.setup();
    await renderTab();
    await user.click(screen.getByRole("combobox", { name: "Candidato" }));
    await user.click(await screen.findByRole("option", { name: /Marta Ruiz/ }));
    await user.click(await screen.findByRole("button", { name: "Quitar filtro" }));
    await waitFor(() => expect(load).toHaveBeenLastCalledWith(ids.draft, undefined));
    expect(screen.queryByRole("group", { name: "Filtro activo" })).toBeNull();
  });
  it("lists every participation with its stage and «Descartado»", async () => {
    const user = userEvent.setup();
    await renderTab();
    await user.click(screen.getByRole("combobox", { name: "Candidato" }));
    const zoe = await screen.findByRole("option", { name: /Zoe Zapata/ });
    expect(zoe).toHaveTextContent("Screening");
    expect(zoe).toHaveTextContent("Descartado");
  });
  it("«Buscar documento» filters by name on the client without reading again", async () => {
    const user = userEvent.setup();
    await renderTab();
    await user.type(screen.getByRole("searchbox", { name: "Buscar documento" }), "firmado");
    expect(screen.queryByRole("row", { name: /Contrato marco/ })).toBeNull();
    expect(row(/Contrato firmado/)).toBeVisible();
    expect(load).toHaveBeenCalledTimes(1);
  });
  it("says a candidate has no documents, by name and stage, with upload and «Quitar filtro»", async () => {
    const user = userEvent.setup();
    await renderTab();
    load.mockResolvedValue({ ok: true, data: wire(value => { value.items = []; value.links = []; }) });
    await user.click(screen.getByRole("combobox", { name: "Candidato" }));
    await user.click(await screen.findByRole("option", { name: /Marta Ruiz/ }));
    expect(await screen.findByRole("heading", { name: "Marta Ruiz todavía no tiene documentos" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Subir documento de Marta" })).toBeVisible();
    expect(screen.getAllByRole("button", { name: "Quitar filtro" }).length).toBeGreaterThan(0);
  });
});

describe("delete and unlink (S10)", () => {
  const manage = () => wire(value => { value.items[1].allowed_actions = ["download", "replace", "delete"]; });
  it("asks first, paints the destructive button with --status-danger, removes the row from the write's scope and returns focus", async () => {
    const user = userEvent.setup();
    await renderTab(manage());
    vi.mocked(deleteDocumentAction).mockResolvedValue({ ok: true, data: { scope: scopeWire({ counts: { documents: 0, links: 1 } }) as never } });
    const trigger = within(row(/Contrato marco/)).getByRole("button", { name: /Más acciones de Contrato marco/ });
    await user.click(trigger);
    await user.click(await screen.findByRole("menuitem", { name: "Eliminar documento" }));
    const dialog = await screen.findByRole("alertdialog", { name: "¿Eliminar «Contrato marco»?" });
    expect(deleteDocumentAction).not.toHaveBeenCalled();
    const confirm = within(dialog).getByRole("button", { name: "Eliminar documento" });
    expect(confirm.className).toContain("bg-status-danger");
    expect(confirm.className).not.toContain("bg-destructive");
    await user.click(confirm);
    expect(deleteDocumentAction).toHaveBeenCalledExactlyOnceWith({ draftId: ids.draft, documentId: ids.document2 });
    await waitFor(() => expect(screen.queryByRole("row", { name: /Contrato marco/ })).toBeNull());
    expect(screen.getByRole("button", { name: /^Vacante/ })).toHaveTextContent("Vacante1");
    expect(load).toHaveBeenCalledTimes(1);
  });
  it("cancelling deletes nothing and gives focus back to the row's actions", async () => {
    const user = userEvent.setup();
    await renderTab(manage());
    const trigger = within(row(/Contrato marco/)).getByRole("button", { name: /Más acciones de Contrato marco/ });
    await user.click(trigger);
    await user.click(await screen.findByRole("menuitem", { name: "Eliminar documento" }));
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(deleteDocumentAction).not.toHaveBeenCalled();
    expect(trigger).toHaveFocus();
  });
  it("shows a failed delete inside the dialog and keeps the row", async () => {
    const user = userEvent.setup();
    await renderTab(manage());
    vi.mocked(deleteDocumentAction).mockResolvedValue({ ok: false, reason: "forbidden", message: "No tienes permiso para modificar los documentos de esta vacante.", reference: { status: 403 } });
    await user.click(within(row(/Contrato marco/)).getByRole("button", { name: /Más acciones/ }));
    await user.click(await screen.findByRole("menuitem", { name: "Eliminar documento" }));
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Eliminar documento" }));
    expect(await screen.findByText("No tienes permiso para modificar los documentos de esta vacante.")).toBeVisible();
    expect(screen.getByRole("row", { name: /Contrato marco/, hidden: true })).toBeInTheDocument();
  });
  it("unlinking asks first, says the original is untouched and deletes the link in its owner's scope", async () => {
    const user = userEvent.setup();
    await renderTab(wire(value => { value.links[1].allowed_actions = ["unlink"]; }));
    vi.mocked(deleteDocumentLinkAction).mockResolvedValue({ ok: true, data: { scope: scopeWire() as never } });
    await user.click(within(row(/Documento eliminado/)).getByRole("button", { name: /Más acciones/ }));
    await user.click(await screen.findByRole("menuitem", { name: "Desvincular" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("El documento original no se toca.");
    const confirm = within(dialog).getByRole("button", { name: "Desvincular" });
    expect(confirm.className).toContain("bg-status-danger");
    await user.click(confirm);
    expect(deleteDocumentLinkAction).toHaveBeenCalledExactlyOnceWith({ draftId: ids.draft, participationId: ids.participation, linkId: ids.link2 });
    await waitFor(() => expect(screen.queryByRole("row", { name: /Documento eliminado/ })).toBeNull());
  });
});
