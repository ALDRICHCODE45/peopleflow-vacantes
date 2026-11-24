import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { createDocumentLinkAction, listDocumentSourcesAction, loadDocumentOverviewAction } from "../actions";
import { mapDocumentFailure } from "../failure";
import { linkWriteSchema, overviewSchema, sourcesSchema, type DocumentOverview } from "../model";
import { ids, linkWire, overviewWire, scopeWire, sourceWire, sourcesWire } from "../test-fixtures";
import { notifyActionResult } from "@/components/feedback/notify";
import { VacancyDocumentsTab } from "./vacancy-documents-tab";

vi.mock("../actions", () => ({
  loadDocumentOverviewAction: vi.fn(), deleteDocumentAction: vi.fn(), deleteDocumentLinkAction: vi.fn(),
  listDocumentVersionsAction: vi.fn(), listDocumentSourcesAction: vi.fn(), createDocumentLinkAction: vi.fn(),
}));
vi.mock("@/components/feedback/notify", () => ({ notifyActionResult: vi.fn() }));
vi.mock("@/components/ui/combobox", async () => (await import("./test-support")).comboboxDouble());
vi.mock("@/components/ui/dropdown-menu", async () => (await import("./test-support")).dropdownMenuDouble());
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, media: "", addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn() })));
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("PointerEvent", MouseEvent); // Base UI Checkbox reads it; jsdom has none.
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

type Wire = ReturnType<typeof overviewWire>;
const wire = (patch: (value: Wire) => void = () => {}): DocumentOverview => { const value = overviewWire(); patch(value); return overviewSchema.parse(value); };
const load = vi.mocked(loadDocumentOverviewAction);
const sources = vi.mocked(listDocumentSourcesAction);
const create = vi.mocked(createDocumentLinkAction);
const notify = vi.mocked(notifyActionResult);
const OPEN = "Vincular del proceso original";
const second = "0193c0ff-0000-7000-8000-000000000062";
const third = "0193c0ff-0000-7000-8000-000000000063";
const fourth = "0193c0ff-0000-7000-8000-000000000064";
const earlier = "0193bfff-0000-7000-8000-000000000002";

const mount = async (overview = wire()) => {
  load.mockResolvedValue({ ok: true, data: overview });
  render(<VacancyDocumentsTab draftId={ids.draft} />);
  await screen.findByRole("table");
};
const document = (id: string, name: string, over: Record<string, unknown> = {}) => ({ id, name, format: "docx", size: 91200, version: 3, version_count: 3, updated_at: "2026-10-03T12:00:00.000000Z", already_linked: false, ...over });
/** The original chain: the original with three documents (one already linked) and replacement 1 with one. */
const chain = () => sourcesSchema.parse({
  can_link: true,
  sources: [
    { process_id: ids.sourceProcess, sequence: 0, participation_id: null, documents: [
      document(ids.source, "Convenio original"), document(second, "Tabulador salarial", { format: "xlsx", size: 219136, version: 1, version_count: 1 }), document(third, "Organigrama", { format: "png", already_linked: true, version: 2 }),
    ] },
    { process_id: earlier, sequence: 1, participation_id: null, documents: [document(fourth, "Perfil del puesto", { version: 1, version_count: 2 })] },
  ],
});
const written = (documentId: string, name: string, version: number, sequence: number, linkId: string, counts = { documents: 1, links: 2 }) => linkWriteSchema.parse({
  link: linkWire({ id: linkId, source: sourceWire({ document_id: documentId, name, version, sequence, has_newer_version: false }) }),
  scope: scopeWire({ counts }),
});
const failed = (status: number, code: string, data?: Record<string, unknown>) => mapDocumentFailure({ error: { kind: "status", status }, envelope: { error: "texto privado", code, ...(data ? { data } : {}) } });
const openSheet = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole("button", { name: OPEN }));
  return screen.findByRole("dialog", { name: OPEN });
};
const pick = async (user: ReturnType<typeof userEvent.setup>, sheet: HTMLElement, name: string) => user.click(await within(sheet).findByRole("checkbox", { name }));

describe("the toolbar button (S2: only what the backend allows)", () => {
  it("shows when the vacancy scope allows «link»", async () => {
    await mount();
    expect(screen.getByRole("button", { name: OPEN })).toBeVisible();
  });
  it("is absent when neither the vacancy scope nor a chosen participation allows it, even if another participation does", async () => {
    await mount(wire(value => { value.scope = scopeWire({ allowed_actions: ["upload"] }) as never; }));
    expect(screen.queryByRole("button", { name: OPEN })).toBeNull();
  });
  it("is absent for a read-only vacancy", async () => {
    await mount(wire(value => { value.scope = scopeWire({ can_manage: false, allowed_actions: [] }) as never; for (const entry of value.participations) entry.scope_allowed_actions = []; }));
    expect(screen.queryByRole("button", { name: OPEN })).toBeNull();
  });
  it("appears once a candidate whose scope allows «link» is chosen, and goes away for one whose scope does not", async () => {
    const user = userEvent.setup();
    const overview = wire(value => { value.scope = scopeWire({ allowed_actions: ["upload"] }) as never; });
    await mount(overview);
    await user.click(screen.getByRole("combobox", { name: "Candidato" }));
    await user.click(await screen.findByRole("option", { name: /Marta Ruiz/ }));
    expect(await screen.findByRole("button", { name: OPEN })).toBeVisible();
    await user.click(screen.getByRole("combobox", { name: "Candidato" }));
    await user.click(await screen.findByRole("option", { name: /Zoe Zapata/ }));
    await waitFor(() => expect(screen.queryByRole("button", { name: OPEN })).toBeNull());
  });
});

describe("T3e layout defects of the sheet", () => {
  it("10: clicking the document's name (the whole row is the label) toggles its checkbox", async () => {
    const user = userEvent.setup();
    await mount();
    sources.mockResolvedValue({ ok: true, data: chain() });
    const sheet = await openSheet(user);
    const checkbox = await within(sheet).findByRole("checkbox", { name: "Convenio original" });
    expect(checkbox).toHaveAttribute("aria-checked", "false");
    await user.click(within(sheet).getByText("Convenio original"));
    expect(checkbox).toHaveAttribute("aria-checked", "true");
    await user.click(within(sheet).getByText("Word · 89 KB · versión actual v3"));
    expect(checkbox).toHaveAttribute("aria-checked", "false");
    expect(checkbox).toHaveClass("min-h-14", "cursor-pointer"); // the whole row is the checkbox: 56 px target
    // The checkbox keeps the document's own name, and clicking it directly toggles once (the row's handler does not double it).
    await user.click(checkbox);
    expect(checkbox).toHaveAttribute("aria-checked", "true");
  });
  it("10: a long name wraps (no truncate) and «Ya vinculado» sits under it, not beside it; a linked row is not a click target", async () => {
    const user = userEvent.setup();
    await mount();
    sources.mockResolvedValue({ ok: true, data: chain() });
    const sheet = await openSheet(user);
    const name = await within(sheet).findByText("Organigrama");
    expect(name).not.toHaveClass("truncate");
    expect(name).toHaveClass("[overflow-wrap:anywhere]");
    const linked = within(sheet).getByRole("checkbox", { name: "Organigrama" });
    expect(within(linked).getByText("Ya vinculado")).toBeVisible();
    expect(linked).toHaveClass("data-disabled:cursor-not-allowed");
    await user.click(name);
    expect(within(sheet).getByRole("checkbox", { name: "Organigrama" })).toHaveAttribute("aria-checked", "false");
  });
  it("10: «Quedan N de M espacios» never wraps and takes its own footer row; the sheet is full width on phones", async () => {
    const user = userEvent.setup();
    await mount();
    sources.mockResolvedValue({ ok: true, data: chain() });
    const sheet = await openSheet(user);
    const free = await within(sheet).findByText("Quedan 48 de 50 espacios");
    expect(free).toHaveClass("whitespace-nowrap", "sm:w-full");
    expect(sheet).toHaveClass("data-[side=right]:w-full");
  });
});

describe("the sheet: documents of the original chain", () => {
  it("reads the sources of the vacancy scope and lists them by origin with format, size and current version", async () => {
    const user = userEvent.setup();
    await mount();
    sources.mockResolvedValue({ ok: true, data: chain() });
    const sheet = await openSheet(user);
    expect(sources).toHaveBeenCalledExactlyOnceWith({ draftId: ids.draft });
    expect(await within(sheet).findByRole("heading", { name: "Proceso original" })).toBeVisible();
    expect(within(sheet).getByRole("heading", { name: "Reemplazo 1" })).toBeVisible();
    const original = within(sheet).getByRole("checkbox", { name: "Convenio original" });
    expect(original).toHaveTextContent("Word · 89 KB · versión actual v3");
    expect(within(sheet).getByRole("checkbox", { name: "Tabulador salarial" })).toHaveTextContent("Excel · 214 KB · versión actual v1");
    expect(within(sheet).getByRole("checkbox", { name: "Perfil del puesto" })).toBeVisible();
    expect(within(sheet).getByText("No se copia ningún archivo: se fija la versión actual. Si el original cambia, verás «hay una versión más nueva».")).toBeVisible();
    expect(within(sheet).getByText("Quedan 48 de 50 espacios")).toBeVisible();
  });
  it("marks an already linked document and does not let it be chosen again", async () => {
    const user = userEvent.setup();
    await mount();
    sources.mockResolvedValue({ ok: true, data: chain() });
    const sheet = await openSheet(user);
    const linked = (await within(sheet).findByRole("checkbox", { name: "Organigrama" }));
    expect(within(linked).getByText("Ya vinculado")).toBeVisible();
    expect(within(sheet).getByRole("checkbox", { name: "Organigrama" })).toHaveAttribute("aria-disabled", "true");
    expect(within(sheet).getByRole("button", { name: "Vincular documentos" })).toBeDisabled();
  });
  it("shows a loading state, then a failure with a retry that reads again", async () => {
    const user = userEvent.setup();
    await mount();
    sources.mockReturnValueOnce(new Promise(() => {}));
    const sheet = await openSheet(user);
    expect(within(sheet).getByRole("status", { name: "Cargando documentos del proceso original" })).toBeVisible();
    cleanup();
    sources.mockReset();
    await mount();
    sources.mockResolvedValueOnce(mapDocumentFailure({ error: { kind: "timeout" } }));
    const again = await openSheet(user);
    expect(await within(again).findByText("No pudimos confirmar la operación. Actualiza la lista para ver si se aplicó antes de volver a intentarlo.")).toBeVisible();
    sources.mockResolvedValueOnce({ ok: true, data: chain() });
    await user.click(within(again).getByRole("button", { name: "Reintentar" }));
    expect(await within(again).findByRole("checkbox", { name: "Convenio original" })).toBeVisible();
    expect(sources).toHaveBeenCalledTimes(2);
  });
  it("explains a target that cannot link (not a replacement, no room) and offers nothing to choose", async () => {
    const user = userEvent.setup();
    await mount();
    sources.mockResolvedValue({ ok: true, data: sourcesSchema.parse({ can_link: false, sources: [] }) });
    const sheet = await openSheet(user);
    expect(await within(sheet).findByText(/Aquí no se pueden vincular documentos/)).toBeVisible();
    expect(within(sheet).queryAllByRole("checkbox")).toHaveLength(0);
  });
  it("says so when the original chain has no documents", async () => {
    const user = userEvent.setup();
    await mount();
    sources.mockResolvedValue({ ok: true, data: sourcesSchema.parse({ can_link: true, sources: [] }) });
    const sheet = await openSheet(user);
    expect(await within(sheet).findByText("El proceso original no tiene documentos para vincular.")).toBeVisible();
  });
  it("reads the chosen participation's scope, and a vacancy/person toggle re-reads the other one when both allow «link»", async () => {
    const user = userEvent.setup();
    await mount();
    await user.click(screen.getByRole("combobox", { name: "Candidato" }));
    await user.click(await screen.findByRole("option", { name: /Marta Ruiz/ }));
    await waitFor(() => expect(load).toHaveBeenLastCalledWith(ids.draft, ids.participation));
    await screen.findByRole("table");
    sources.mockResolvedValue({ ok: true, data: chain() });
    const sheet = await openSheet(user);
    await within(sheet).findByRole("checkbox", { name: "Convenio original" });
    expect(sources).toHaveBeenLastCalledWith({ draftId: ids.draft, participationId: ids.participation });
    expect(within(sheet).getByRole("button", { name: "A Marta" })).toHaveAttribute("aria-pressed", "true");
    await user.click(within(sheet).getByRole("button", { name: "A la vacante" }));
    await waitFor(() => expect(sources).toHaveBeenLastCalledWith({ draftId: ids.draft }));
    expect(within(sheet).getByRole("button", { name: "A la vacante" })).toHaveAttribute("aria-pressed", "true");
  });
});

describe("pinning and linking", () => {
  it("pins the version it showed and links the chosen documents one by one, applying each {link, scope} to the table", async () => {
    const user = userEvent.setup();
    await mount();
    sources.mockResolvedValue({ ok: true, data: chain() });
    create
      .mockResolvedValueOnce({ ok: true, data: written(ids.source, "Convenio original", 3, 0, "0193c0ee-0000-7000-8000-000000000071") })
      .mockResolvedValueOnce({ ok: true, data: written(fourth, "Perfil del puesto", 1, 1, "0193c0ee-0000-7000-8000-000000000072", { documents: 1, links: 3 }) });
    const sheet = await openSheet(user);
    await pick(user, sheet, "Convenio original");
    await pick(user, sheet, "Perfil del puesto");
    expect(within(sheet).getByText("Se fijará la versión 3")).toBeVisible();
    expect(within(sheet).getByText("Se fijará la versión 1")).toBeVisible();
    await user.click(within(sheet).getByRole("button", { name: "Vincular 2 documentos" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: OPEN })).toBeNull());
    expect(create.mock.calls).toEqual([
      [{ draftId: ids.draft, sourceDocumentId: ids.source, version: 3 }],
      [{ draftId: ids.draft, sourceDocumentId: fourth, version: 1 }],
    ]);
    const original = screen.getByRole("row", { name: /Convenio original/ });
    expect(within(original).getByText("Proceso original")).toBeVisible();
    expect(within(original).getByText("v3 fijada")).toBeVisible();
    expect(within(screen.getByRole("row", { name: /Perfil del puesto/ })).getByText("Reemplazo 1")).toBeVisible();
    expect(screen.getByRole("button", { name: /^Vacante/ })).toHaveTextContent("Vacante4");
    expect(load).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ type: "success", title: "Se vincularon 2 documentos" }));
  });
  it("links one document with the singular wording and into the participation scope when that one is the destination", async () => {
    const user = userEvent.setup();
    await mount();
    await user.click(screen.getByRole("combobox", { name: "Candidato" }));
    await user.click(await screen.findByRole("option", { name: /Marta Ruiz/ }));
    await waitFor(() => expect(load).toHaveBeenLastCalledWith(ids.draft, ids.participation));
    sources.mockResolvedValue({ ok: true, data: chain() });
    create.mockResolvedValue({ ok: true, data: written(second, "Tabulador salarial", 1, 0, "0193c0ee-0000-7000-8000-000000000073") });
    const sheet = await openSheet(user);
    await pick(user, sheet, "Tabulador salarial");
    await user.click(within(sheet).getByRole("button", { name: "Vincular 1 documento" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: OPEN })).toBeNull());
    expect(create).toHaveBeenCalledExactlyOnceWith({ draftId: ids.draft, participationId: ids.participation, sourceDocumentId: second, version: 1 });
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ type: "success", title: "Se vinculó 1 documento" }));
  });
  it("lets a chosen document be unchosen before linking", async () => {
    const user = userEvent.setup();
    await mount();
    sources.mockResolvedValue({ ok: true, data: chain() });
    const sheet = await openSheet(user);
    await pick(user, sheet, "Convenio original");
    expect(within(sheet).getByRole("button", { name: "Vincular 1 documento" })).toBeEnabled();
    await pick(user, sheet, "Convenio original");
    expect(within(sheet).getByRole("button", { name: "Vincular documentos" })).toBeDisabled();
    expect(within(sheet).queryByText("Se fijará la versión 3")).toBeNull();
  });
});

describe("failures", () => {
  const stuck = async (failure: ReturnType<typeof failed>, firstOk = true) => {
    const user = userEvent.setup();
    await mount();
    sources.mockResolvedValue({ ok: true, data: chain() });
    if (firstOk) create.mockResolvedValueOnce({ ok: true, data: written(ids.source, "Convenio original", 3, 0, "0193c0ee-0000-7000-8000-000000000071") });
    create.mockResolvedValueOnce(failure as never);
    const sheet = await openSheet(user);
    await pick(user, sheet, "Convenio original");
    await pick(user, sheet, "Tabulador salarial");
    await pick(user, sheet, "Perfil del puesto");
    await user.click(within(sheet).getByRole("button", { name: "Vincular 3 documentos" }));
    return { user, sheet };
  };
  it("already linked: says so, marks that document as linked and reads the list again", async () => {
    const { sheet } = await stuck(failed(409, "document_already_linked", { link_id: ids.link }), false);
    expect(await within(sheet).findByRole("alert")).toHaveTextContent("Convenio original: Ese documento ya está vinculado a este espacio.");
    expect(within(sheet).getByRole("checkbox", { name: "Convenio original" })).toHaveAttribute("aria-disabled", "true");
    expect(within(sheet).getByRole("button", { name: "Vincular 2 documentos" })).toBeEnabled();
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
  });
  it("limit reached: stops at that document, keeps the first one linked and the rest chosen", async () => {
    const { sheet } = await stuck(failed(409, "document_limit_reached", { kind: "documents", limit: 50 }));
    expect(await within(sheet).findByRole("alert")).toHaveTextContent("Tabulador salarial: Este espacio ya tiene 50 documentos, que es el máximo. Elimina o desvincula alguno para continuar.");
    expect(create).toHaveBeenCalledTimes(2);
    expect(within(sheet).getByRole("checkbox", { name: "Convenio original" })).toHaveAttribute("aria-disabled", "true");
    expect(within(within(sheet).getByRole("checkbox", { name: "Convenio original" })).getByText("Ya vinculado")).toBeVisible();
    expect(within(sheet).getByRole("checkbox", { name: "Tabulador salarial" })).toBeChecked();
    expect(within(sheet).getByRole("checkbox", { name: "Perfil del puesto" })).toBeChecked();
    expect(within(sheet).getByRole("button", { name: "Vincular 2 documentos" })).toBeEnabled();
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2)); // the limit moved the scope: the table is read again
  });
  it("not found: names the document and keeps the sheet open", async () => {
    const { sheet } = await stuck(failed(404, "not_found"), false);
    expect(await within(sheet).findByRole("alert")).toHaveTextContent("Convenio original: No encontramos este documento o ya no tienes acceso.");
    expect(screen.getByRole("dialog", { name: OPEN })).toBeVisible();
    expect(create).toHaveBeenCalledTimes(1);
  });
  it("shows the mapped reason of an invalid source", async () => {
    const { sheet } = await stuck(failed(422, "document_link_invalid", { reason: "source_not_in_chain" }), false);
    expect(await within(sheet).findByRole("alert")).toHaveTextContent("Ese documento no pertenece al proceso original de este reemplazo.");
  });
  it("never lets the sheet close while a link is in flight", async () => {
    const user = userEvent.setup();
    await mount();
    sources.mockResolvedValue({ ok: true, data: chain() });
    create.mockReturnValue(new Promise(() => {}));
    const sheet = await openSheet(user);
    await pick(user, sheet, "Convenio original");
    await user.click(within(sheet).getByRole("button", { name: "Vincular 1 documento" }));
    expect(await within(sheet).findByRole("button", { name: "Vinculando…" })).toBeDisabled();
    expect(within(sheet).getByRole("button", { name: "Cancelar" })).toBeDisabled();
    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog", { name: OPEN })).toBeVisible();
  });
});

describe("focus", () => {
  it("returns to the toolbar button when the sheet is cancelled", async () => {
    const user = userEvent.setup();
    await mount();
    sources.mockResolvedValue({ ok: true, data: chain() });
    const sheet = await openSheet(user);
    await within(sheet).findByRole("checkbox", { name: "Convenio original" });
    await user.click(within(sheet).getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: OPEN })).toBeNull());
    expect(screen.getByRole("button", { name: OPEN })).toHaveFocus();
  });
  it("returns to the toolbar button after linking, and with Escape", async () => {
    const user = userEvent.setup();
    await mount();
    sources.mockResolvedValue({ ok: true, data: chain() });
    create.mockResolvedValue({ ok: true, data: written(ids.source, "Convenio original", 3, 0, "0193c0ee-0000-7000-8000-000000000071") });
    const sheet = await openSheet(user);
    await pick(user, sheet, "Convenio original");
    await user.click(within(sheet).getByRole("button", { name: "Vincular 1 documento" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: OPEN })).toBeNull());
    await waitFor(() => expect(screen.getByRole("button", { name: OPEN })).toHaveFocus());
    sources.mockResolvedValue({ ok: true, data: sourcesSchema.parse(sourcesWire()) });
    await openSheet(user);
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: OPEN })).toBeNull());
    expect(screen.getByRole("button", { name: OPEN })).toHaveFocus();
  });
});
