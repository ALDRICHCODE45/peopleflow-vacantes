import type { ComponentProps, ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { loadDraftForEditAction } from "@/features/jobs/drafts/reopen/load";
import { loadDraftPublicationAction, publishDraftAction } from "@/features/jobs/drafts/pipeline/publication-actions";
import { loadDraftDeliveryAction } from "@/features/jobs/drafts/pipeline/delivery-actions";
import { loadDraftPipelineAction } from "@/features/jobs/drafts/pipeline/actions";
import { draftEditSeedFromRead } from "@/features/jobs/drafts/reopen/seed";
import { filledDraftRead } from "@/features/jobs/drafts/reopen/test-fixture";
import { loadBoardAction } from "@/features/pipeline-movement/actions";
import { loadReplacementSummaryAction } from "@/features/vacancy-replacement/actions";
import { boardFixture } from "@/features/pipeline-movement/board-fixture";
import type { Board } from "@/features/pipeline-movement/model";
import { getLifecycleAction } from "@/features/vacancy-lifecycle/actions";
import type { Lifecycle } from "@/features/vacancy-lifecycle/model";
import type { StartReplacementDialogProps } from "@/features/vacancy-replacement/start-replacement-dialog";
import { DraftPipelineState } from "./draft-pipeline-state";

// replacement-processes T4 wiring: the card «⋯» menu and the header «Acciones» both land in the start-replacement dialog of the source board.
const router = { push: vi.fn(), refresh: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router }));
// The dialog has its own suite: here only what the screen hands it (and what it does with `onStarted`) matters.
vi.mock("@/features/vacancy-replacement/start-replacement-dialog", () => ({
  StartReplacementDialog: (props: StartReplacementDialogProps) => props.open
    ? <div role="dialog" aria-label="Iniciar reemplazo">
      <p data-testid="draft">{props.draftId}</p>
      <p data-testid="title">{props.title}</p>
      <p data-testid="credit">{props.preselectedCreditId ?? "sin preselección"}</p>
      <p data-testid="stages">{JSON.stringify(props.stages)}</p>
      <p data-testid="unavailable">{JSON.stringify(props.unavailableHires)}</p>
      <button type="button" onClick={() => { props.onStarted("9".repeat(8) + "-0000-4000-8000-000000000009"); props.onOpenChange(false); }}>Terminar</button>
      <button type="button" onClick={() => props.onOpenChange(false)}>Cerrar</button>
    </div>
    : null,
}));
vi.mock("@/features/vacancy-replacement/actions", () => ({ loadReplacementSummaryAction: vi.fn() }));
vi.mock("@/features/pipeline-movement/actions", () => ({ loadBoardAction: vi.fn(), loadHistoryAction: vi.fn(), loadParticipationAction: vi.fn(), moveParticipationAction: vi.fn(), discardParticipationAction: vi.fn(), recoverParticipationAction: vi.fn(), setParticipationSubstateAction: vi.fn() }));
vi.mock("@/features/jobs/drafts/pipeline/publication-actions", () => ({ loadDraftPublicationAction: vi.fn(), publishDraftAction: vi.fn() }));
vi.mock("@/features/jobs/drafts/pipeline/delivery-actions", () => ({ loadDraftDeliveryAction: vi.fn() }));
vi.mock("@/features/jobs/drafts/reopen/load", () => ({ loadDraftForEditAction: vi.fn() }));
vi.mock("@/features/jobs/drafts/pipeline/actions", () => ({ loadDraftPipelineAction: vi.fn(), saveDraftPipelineAction: vi.fn() }));
vi.mock("@/features/vacancy-lifecycle/actions", () => ({ getLifecycleAction: vi.fn(), transitionLifecycleAction: vi.fn() }));
vi.mock("@/features/manual-intake/actions", () => ({ checkDuplicatesAction: vi.fn() }));
vi.mock("@/features/manual-intake/upload", () => ({ submitManualCandidate: vi.fn() }));
vi.mock("@/components/feedback/notify", () => ({ notifyActionResult: vi.fn() }));
vi.mock("@/components/company-dashboard/site-header", () => ({ SiteHeader: ({ title }: { title: ReactNode }) => <header><h1>{title}</h1></header> }));
vi.mock("@/components/ui/combobox", () => ({
  Combobox: ({ children }: { children: ReactNode }) => <>{children}</>, ComboboxInput: ({ id }: { id: string }) => <input id={id} />,
  ComboboxContent: () => null, ComboboxEmpty: () => null, ComboboxList: () => null, ComboboxItem: () => null, useComboboxAnchor: () => ({ current: null }),
}));
vi.mock("@/features/geo/use-geo-catalog", () => ({ useGeoCatalog: () => ({ countries: { status: "success", data: { items: [] } }, states: { status: "success", data: { items: [] } }, municipalities: { status: "success", data: { items: [] } } }), useGeoPostalCode: () => ({ status: "idle" }) }));
// Only the portal boundary: product menu composition, not Base UI positioning.
vi.mock("@/components/ui/dropdown-menu", async () => {
  const React = await import("react");
  const Menu = React.createContext(false);
  return {
    DropdownMenu: ({ children, onOpenChange }: { children: ReactNode; onOpenChange?: (open: boolean) => void }) => { const [open, setOpen] = React.useState(false); return <Menu.Provider value={open}><div onClick={() => { if (!open) onOpenChange?.(true); setOpen(true); }}>{children}</div></Menu.Provider>; },
    DropdownMenuTrigger: ({ render: trigger, children }: { render: ReactElement; children: ReactNode }) => React.cloneElement(trigger, { "aria-haspopup": "menu", children } as ComponentProps<"button">),
    DropdownMenuContent: ({ children }: { children: ReactNode }) => React.useContext(Menu) ? <div role="menu">{children}</div> : null,
    DropdownMenuSeparator: () => <div role="separator" />,
    DropdownMenuSub: ({ children }: { children: ReactNode }) => <>{children}</>,
    DropdownMenuSubTrigger: ({ children }: { children: ReactNode }) => <button>{children}</button>,
    DropdownMenuSubContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    DropdownMenuRadioGroup: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    DropdownMenuRadioItem: ({ children }: { children: ReactNode }) => <button role="menuitemradio" aria-checked="false">{children}</button>,
    DropdownMenuGroup: ({ children }: { children: ReactNode }) => <div role="group">{children}</div>,
    DropdownMenuLabel: ({ children }: { children: ReactNode }) => <span>{children}</span>,
    DropdownMenuItem: ({ children, onClick, disabled, render }: ComponentProps<"button"> & { render?: ReactElement<Record<string, unknown>> }) => render
      ? React.cloneElement(render, { role: "menuitem", children }) : <button role="menuitem" disabled={disabled} onClick={onClick}>{children}</button>,
  };
});
vi.mock("@/components/ui/popover", async () => {
  const React = await import("react");
  const Open = React.createContext(false);
  return {
    Popover: ({ open = false, children }: { open?: boolean; children: ReactNode }) => <Open.Provider value={open}>{children}</Open.Provider>,
    PopoverTrigger: ({ render }: { render: ReactElement }) => render,
    PopoverContent: ({ children, "aria-label": label }: { children: ReactNode; "aria-label"?: string }) => React.useContext(Open) ? <div role="dialog" aria-label={label}>{children}</div> : null,
    PopoverHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    PopoverTitle: ({ children }: { children: ReactNode }) => <h4>{children}</h4>,
    PopoverDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
  };
});
vi.mock("@dnd-kit/core", () => ({
  DndContext: ({ children }: { children: ReactNode }) => <>{children}</>, DragOverlay: ({ children }: { children: ReactNode }) => <div aria-hidden="true">{children}</div>,
  useDraggable: () => ({ attributes: {}, listeners: {}, setNodeRef: () => {}, setActivatorNodeRef: () => {}, isDragging: false }),
  useDroppable: () => ({ setNodeRef: () => {}, isOver: false }), useSensors: () => [], useSensor: () => ({}), PointerSensor: {}, KeyboardSensor: {}, pointerWithin: vi.fn(), closestCorners: vi.fn(),
}));

const read = filledDraftRead();
const newDraft = "99999999-0000-4000-8000-000000000009";
const leftAt = "2026-11-17T18:00:00Z";
const startable: Lifecycle = {
  close_reason: "filled", close_reason_note: null, publication: "closed", process: "finished", version: "2", published_at: null, paused_at: null,
  closed_at: "2026-11-03T12:00:00Z", process_finished_at: "2026-11-03T12:00:00Z", allowed_actions: [],
  kind: "original", sequence: null, replacement_of: null, root_process_id: read.id, visibility: "public", closed_covered: true,
  can_start_replacement: true, start_replacement_blocker: null, startable_credits_count: 1, active_replacement_id: null,
};
/** Ana left Placement («No se sostuvo»); Bruno is still placed. */
function closedBoard(): Board {
  const board = boardFixture();
  const ana = { ...board.participations[0], stage_id: "exit", moved_at: leftAt, discard: { reason: { group: "candidate" as const, key: "no_longer_interested" as const }, previous_stage_id: "hire", recovery_stage_id: "hire", discarded_at: leftAt } };
  const bruno = { ...board.participations[0], id: "bruno", stage_id: "hire", candidate: { id: "bruno-candidate", full_name: "Bruno Soto", kind: "organic" as const } };
  board.lifecycle = startable;
  board.participations = [ana, bruno];
  board.stages[0].count = 0; board.stages[3].count = 1; board.exit.count = 1;
  return board;
}
// What the board's single GET V/replacements leaves: Ana's startable credit, resolved by her participation id.
const credit = { id: "credit-1", participationId: "person", hiredAt: "2026-10-22T12:00:00Z", leftAt }

async function mount(board: Board = closedBoard()) {
  vi.mocked(loadDraftForEditAction).mockResolvedValue({ ok: true, seed: { ...draftEditSeedFromRead(read), lifecycle: { ...read.lifecycle, publication: "published", process: "active" } }, identity: { draftId: read.id, etag: '"etag"' } });
  vi.mocked(loadDraftPublicationAction).mockResolvedValue({ ok: true, publication: { status: "published", publishedAt: "2026-10-16T12:00:00Z", missing: [] } });
  vi.mocked(loadBoardAction).mockResolvedValue({ ok: true, data: board });
  vi.mocked(loadReplacementSummaryAction).mockResolvedValue({ ok: true, data: { items: [], credits: [credit] } });
  vi.mocked(getLifecycleAction).mockResolvedValue({ ok: true, etag: "lifecycle-tag", data: startable });
  render(<DraftPipelineState draftId={read.id} />);
  await screen.findByRole("heading", { name: "Entrada" });
  await screen.findByText("No se sostuvo", { selector: '[data-slot="badge"]' });
}
const dialog = () => screen.getByRole("dialog", { name: "Iniciar reemplazo" });
const shown = (id: string) => within(dialog()).getByTestId(id).textContent;

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(loadDraftPipelineAction).mockResolvedValue({ ok: false, reason: "not_found", reference: {} });
});
afterEach(cleanup);

it("starts closed: no dialog until an entry point asks for it", async () => {
  await mount();
  expect(screen.queryByRole("dialog", { name: "Iniciar reemplazo" })).not.toBeInTheDocument();
});
it("the card «⋯» menu opens the dialog with that hire's credit preselected and the source board stages", async () => {
  await mount();
  fireEvent.click(screen.getByRole("button", { name: "Acciones de Ana Pérez" }));
  fireEvent.click(within(screen.getByRole("menu")).getByRole("menuitem", { name: "Iniciar reemplazo" }));
  expect(shown("draft")).toBe(read.id);
  expect(shown("credit")).toBe("credit-1");
  expect(JSON.parse(shown("stages")!)).toEqual([
    { id: "new", kind: "new", name: "Entrada" }, { id: "screen", kind: "screening", name: "Revisión" },
    { id: "interview", kind: "custom", name: "Entrevista" }, { id: "hire", kind: "placement", name: "Contratación" },
  ]);
  expect(shown("title")).toBe(read.fields.title);
});
it("the header «Acciones» menu opens the dialog without a preselected credit", async () => {
  await mount();
  fireEvent.click(await screen.findByRole("button", { name: `Acciones de ${read.fields.title}` }));
  fireEvent.click(await screen.findByRole("menuitem", { name: "Iniciar reemplazo" }));
  expect(shown("draft")).toBe(read.id);
  expect(shown("credit")).toBe("sin preselección");
});
it("hires still in Placement are handed over as unavailable («todavía en Contratación»), departed ones are not", async () => {
  await mount();
  fireEvent.click(await screen.findByRole("button", { name: `Acciones de ${read.fields.title}` }));
  fireEvent.click(await screen.findByRole("menuitem", { name: "Iniciar reemplazo" }));
  expect(JSON.parse(shown("unavailable")!)).toEqual([{ id: "bruno", name: "Bruno Soto", reason: "still_placed" }]);
});
it("onStarted navigates to the new draft's pipeline and refreshes; the dialog is gone", async () => {
  await mount();
  fireEvent.click(await screen.findByRole("button", { name: `Acciones de ${read.fields.title}` }));
  fireEvent.click(await screen.findByRole("menuitem", { name: "Iniciar reemplazo" }));
  fireEvent.click(within(dialog()).getByRole("button", { name: "Terminar" }));
  expect(router.push).toHaveBeenCalledExactlyOnceWith(`/empresa/vacantes/${newDraft}/pipeline`);
  expect(router.refresh).toHaveBeenCalledOnce();
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Iniciar reemplazo" })).not.toBeInTheDocument());
});
it("closing without starting does not navigate, and the next request starts clean", async () => {
  await mount();
  fireEvent.click(screen.getByRole("button", { name: "Acciones de Ana Pérez" }));
  fireEvent.click(within(screen.getByRole("menu")).getByRole("menuitem", { name: "Iniciar reemplazo" }));
  fireEvent.click(within(dialog()).getByRole("button", { name: "Cerrar" }));
  expect(screen.queryByRole("dialog", { name: "Iniciar reemplazo" })).not.toBeInTheDocument();
  expect(router.push).not.toHaveBeenCalled();
  // The card menu stays open in this jsdom double: the header item is the first of the two.
  fireEvent.click(await screen.findByRole("button", { name: `Acciones de ${read.fields.title}` }));
  await waitFor(() => expect(screen.getAllByRole("menuitem", { name: "Iniciar reemplazo" })).toHaveLength(2));
  fireEvent.click(screen.getAllByRole("menuitem", { name: "Iniciar reemplazo" })[0]);
  expect(shown("credit")).toBe("sin preselección");
});

// S5/S6 «Private by default, publish later» (contract D4): a private replacement has publication `published` + visibility `private` in its
// lifecycle while `GET V/publication` answers «draft». The screen decides from the lifecycle.
const original = "223e4567-e89b-42d3-a456-426614174000";
const privateLifecycle: Lifecycle = {
  close_reason: null, close_reason_note: null, publication: "published", process: "active", version: "1", published_at: "2026-11-19T18:00:00Z", paused_at: null,
  closed_at: null, process_finished_at: null, allowed_actions: ["pause", "close", "publish"],
  kind: "replacement", sequence: 1, replacement_of: original, root_process_id: original, visibility: "private", closed_covered: false,
  can_start_replacement: false, start_replacement_blocker: "source_not_closed", startable_credits_count: 0, active_replacement_id: null,
};
const publicLifecycle: Lifecycle = { ...privateLifecycle, visibility: "public", allowed_actions: ["pause", "close"] };
async function mountPrivate(boards: Board[] = []) {
  const board = (lifecycle: Lifecycle) => { const value = boardFixture(); value.lifecycle = lifecycle; return value; };
  vi.mocked(loadDraftForEditAction).mockResolvedValue({ ok: true, seed: { ...draftEditSeedFromRead(read), lifecycle: privateLifecycle }, identity: { draftId: read.id, etag: '"etag"' } });
  vi.mocked(loadDraftPublicationAction).mockResolvedValue({ ok: true, publication: { status: "draft", publishedAt: null, missing: [] } });
  vi.mocked(loadBoardAction).mockResolvedValue({ ok: true, data: board(privateLifecycle) });
  for (const next of boards) vi.mocked(loadBoardAction).mockResolvedValueOnce({ ok: true, data: next });
  vi.mocked(loadReplacementSummaryAction).mockResolvedValue({ ok: true, data: { items: [], credits: [] } });
  vi.mocked(getLifecycleAction).mockResolvedValue({ ok: true, etag: "lifecycle-tag", data: privateLifecycle });
  vi.mocked(loadDraftDeliveryAction).mockResolvedValue({ ok: true, etag: '"delivery"', delivery: { fulfilled: false, version: "1", cutoffStageId: "new", targetQuantity: 1, commitmentDate: "2026-11-30", limits: { maxTargetQuantity: 999 }, calendar: { timeZone: "America/Mexico_City", today: "2026-11-19", minDate: "2026-11-19", maxDate: "2027-11-19", nonBusinessDates: [] } } });
  vi.mocked(loadDraftPipelineAction).mockResolvedValue({ ok: true, etag: '"pipeline"', pipeline: { retired: [], version: "1", stages: [{ id: "new", kind: "new", name: "Entrada" }], exit: { id: "exit", kind: "discarded", name: "Fuera" }, limits: { maxCustomStages: 3, nameMaxLength: 40 }, structure_locked: false } });
  render(<DraftPipelineState draftId={read.id} />);
  await screen.findByRole("heading", { name: "Entrada" });
}
it("S6: a private replacement (publication read «draft», lifecycle published + private) opens its board, not the draft screen", async () => {
  await mountPrivate();
  expect(screen.getByRole("region", { name: "Tablero de candidatos" })).toBeVisible();
  expect(screen.queryByText("Esta vacante todavía no tiene pipeline")).not.toBeInTheDocument();
  expect(screen.queryByText("Vacante en borrador")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Publicar vacante" })).not.toBeInTheDocument();
});
it("S6: the board says «Proceso iniciado» and «Privada · sin publicar» instead of a publication date while private", async () => {
  await mountPrivate();
  expect(screen.getByText(/Proceso iniciado el/)).toBeVisible();
  expect(screen.getByText("Privada · sin publicar")).toBeVisible();
  expect(screen.queryByText(/Publicada el/)).not.toBeInTheDocument();
});
it("S6: a real draft (lifecycle without a publication) keeps today's draft screen even if the publication read says published", async () => {
  vi.mocked(loadDraftForEditAction).mockResolvedValue({ ok: true, seed: { ...draftEditSeedFromRead(read), lifecycle: { ...read.lifecycle, publication: null, process: null, allowed_actions: [] } }, identity: { draftId: read.id, etag: '"etag"' } });
  vi.mocked(loadDraftPublicationAction).mockResolvedValue({ ok: true, publication: { status: "draft", publishedAt: null, missing: [] } });
  render(<DraftPipelineState draftId={read.id} />);
  expect(await screen.findByRole("heading", { name: "Esta vacante todavía no tiene pipeline" })).toBeVisible();
  expect(loadBoardAction).not.toHaveBeenCalled();
});
it("S5: «Acciones» of a private replacement offers «Publicar»; publishing sends the usual publication request and re-reads the board", async () => {
  const publishedAt = "2026-11-20T12:00:00Z";
  vi.mocked(publishDraftAction).mockResolvedValue({ ok: true, publication: { id: read.id, status: "published", publishedAt } });
  const priv = boardFixture(); priv.lifecycle = privateLifecycle;
  const board = boardFixture(); board.lifecycle = publicLifecycle;
  await mountPrivate([priv, board]);
  fireEvent.click(await screen.findByRole("button", { name: `Acciones de ${read.fields.title}` }));
  fireEvent.click(await screen.findByRole("menuitem", { name: "Publicar" }));
  const confirm = await screen.findByRole("alertdialog", { name: `¿Publicar ${read.fields.title}?` });
  fireEvent.click(within(confirm).getByRole("button", { name: "Publicar vacante" }));
  await waitFor(() => expect(publishDraftAction).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ draftId: read.id, ifMatch: '"etag"', body: {} })));
  // The board is read again: it now answers public, so the screen drops «Privada · sin publicar» and the menu offers no «Publicar».
  await waitFor(() => expect(screen.queryByText("Privada · sin publicar")).not.toBeInTheDocument());
  expect(vi.mocked(loadBoardAction).mock.calls.length).toBeGreaterThanOrEqual(2);
});
it("S5/S6: after publishing, the board keeps «Proceso iniciado el <inicio>» and adds «Publicada el <fecha de publicación>»", async () => {
  const publishedAt = "2026-11-21T12:00:00Z";
  vi.mocked(publishDraftAction).mockResolvedValue({ ok: true, publication: { id: read.id, status: "published", publishedAt } });
  const priv = boardFixture(); priv.lifecycle = privateLifecycle;
  const board = boardFixture(); board.lifecycle = publicLifecycle;
  await mountPrivate([priv, board]);
  expect(screen.getByText(/Proceso iniciado el/)).toHaveTextContent("19 nov 2026");
  // `GET V/publication` answers «draft» until the projection exists, then the projection's own time.
  vi.mocked(loadDraftPublicationAction).mockImplementation(async () => vi.mocked(publishDraftAction).mock.calls.length
    ? { ok: true, publication: { status: "published", publishedAt, missing: [] } } : { ok: true, publication: { status: "draft", publishedAt: null, missing: [] } });
  fireEvent.click(await screen.findByRole("button", { name: `Acciones de ${read.fields.title}` }));
  fireEvent.click(await screen.findByRole("menuitem", { name: "Publicar" }));
  const confirm = await screen.findByRole("alertdialog", { name: `¿Publicar ${read.fields.title}?` });
  fireEvent.click(within(confirm).getByRole("button", { name: "Publicar vacante" }));
  // While the board re-reads (no board yet) the header falls back to the publication date alone, so wait for the board's own lines.
  await waitFor(() => expect(screen.getByText(/Proceso iniciado el/)).toHaveTextContent("Proceso iniciado el 19 nov 2026"));
  expect(screen.getByText(/Publicada el/)).toHaveTextContent("Publicada el 21 nov 2026");
  expect(screen.queryByText("Privada · sin publicar")).not.toBeInTheDocument();
});
it("S5: a public replacement's «Acciones» (lifecycle without «publish») never lists «Publicar»", async () => {
  await mountPrivate();
  vi.mocked(getLifecycleAction).mockResolvedValue({ ok: true, etag: "lifecycle-tag", data: publicLifecycle });
  fireEvent.click(await screen.findByRole("button", { name: `Acciones de ${read.fields.title}` }));
  await screen.findByRole("menuitem", { name: "Pausar" });
  expect(screen.queryByRole("menuitem", { name: "Publicar" })).not.toBeInTheDocument();
});
