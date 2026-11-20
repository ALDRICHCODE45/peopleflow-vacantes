import type { ComponentProps, ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { notifyActionResult } from "@/components/feedback/notify";
import { listDraftsAction } from "@/features/jobs/drafts/list/actions";
import type { DraftListRow } from "@/features/jobs/drafts/list/client";
import { loadBoardAction } from "@/features/pipeline-movement/actions";
import { boardFixture } from "@/features/pipeline-movement/board-fixture";
import { getLifecycleAction } from "@/features/vacancy-lifecycle/actions";
import type { Lifecycle } from "@/features/vacancy-lifecycle/model";
import type { StartReplacementDialogProps } from "@/features/vacancy-replacement/start-replacement-dialog";
import { VacancyPortfolio } from "./vacancy-portfolio";

// replacement-processes T4 wiring: the portfolio has no board, so the dialog's source stages are read when «Iniciar reemplazo» is chosen.
const router = { push: vi.fn(), refresh: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@/features/vacancy-replacement/start-replacement-dialog", () => ({
  StartReplacementDialog: (props: StartReplacementDialogProps) => props.open
    ? <div role="dialog" aria-label="Iniciar reemplazo">
      <p data-testid="draft">{props.draftId}</p>
      <p data-testid="title">{props.title}</p>
      <p data-testid="credit">{props.preselectedCreditId ?? "sin preselección"}</p>
      <p data-testid="stages">{props.stages.map(stage => stage.name).join(",")}</p>
      <p data-testid="unavailable">{(props.unavailableHires ?? []).map(hire => `${hire.name}:${hire.reason}`).join(",")}</p>
      <button type="button" onClick={() => { props.onStarted("9".repeat(8) + "-0000-4000-8000-000000000009"); props.onOpenChange(false); }}>Terminar</button>
      <button type="button" onClick={() => props.onOpenChange(false)}>Cerrar</button>
    </div>
    : null,
}));
vi.mock("@/features/jobs/drafts/list/actions", () => ({ listDraftsAction: vi.fn() }));
vi.mock("@/features/pipeline-movement/actions", () => ({ loadBoardAction: vi.fn() }));
vi.mock("@/features/vacancy-lifecycle/actions", () => ({ getLifecycleAction: vi.fn(), transitionLifecycleAction: vi.fn() }));
vi.mock("@/components/feedback/notify", () => ({ notifyActionResult: vi.fn(), dismissActionResult: vi.fn() }));
vi.mock("@/components/ui/dropdown-menu", async () => {
  const React = await import("react");
  const Menu = React.createContext(false);
  return {
    DropdownMenu: ({ children, onOpenChange }: { children: ReactNode; onOpenChange?: (open: boolean) => void }) => { const [open, setOpen] = React.useState(false); return <Menu.Provider value={open}><div onClick={() => { if (!open) onOpenChange?.(true); setOpen(true); }}>{children}</div></Menu.Provider>; },
    DropdownMenuTrigger: ({ render: trigger, children }: { render: ReactElement; children: ReactNode }) => React.cloneElement(trigger, { "aria-haspopup": "menu", children } as ComponentProps<"button">),
    DropdownMenuContent: ({ children }: { children: ReactNode }) => React.useContext(Menu) ? <div role="menu">{children}</div> : null,
    DropdownMenuGroup: ({ children }: { children: ReactNode }) => <div role="group">{children}</div>,
    DropdownMenuItem: ({ children, onClick, disabled, render }: ComponentProps<"button"> & { render?: ReactElement<Record<string, unknown>> }) => render
      ? React.cloneElement(render, { role: "menuitem", children }) : <button role="menuitem" disabled={disabled} onClick={onClick}>{children}</button>,
  };
});

const original = "123e4567-e89b-42d3-a456-426614174000";
const newDraft = "99999999-0000-4000-8000-000000000009";
const row: DraftListRow = { close_reason: "filled", close_reason_note: null, candidates: { total: 8, in_process: 0, discarded: 3, by_stage: [] }, paused_at: null, closed_at: "2026-11-03T12:00:00Z", process_finished_at: "2026-11-03T12:00:00Z", id: original, status: "closed", process: "finished", published_at: "2026-10-01T12:00:00Z", title: "Supervisor de Almacén", work_mode: "onsite", work_schedule: "full_time", requester: null, team: { mode: "with_responsible", responsible: { id: original, name: "Sofía" }, members_count: 1, viewer_function: "responsible" }, version: "1", created_at: "2026-10-01T12:00:00Z", updated_at: "2026-11-03T12:00:00Z" };
const startable: Lifecycle = {
  close_reason: "filled", close_reason_note: null, publication: "closed", process: "finished", version: "2", published_at: null, paused_at: null,
  closed_at: "2026-11-03T12:00:00Z", process_finished_at: "2026-11-03T12:00:00Z", allowed_actions: [],
  kind: "original", sequence: null, replacement_of: null, root_process_id: original, visibility: "public", closed_covered: true,
  can_start_replacement: true, start_replacement_blocker: null, startable_credits_count: 1, active_replacement_id: null,
};
/** One hire still in Placement next to the departed ones. */
function sourceBoard() {
  const board = boardFixture();
  board.lifecycle = startable;
  board.participations[0] = { ...board.participations[0], stage_id: "hire" };
  return board;
}
async function chooseStart() {
  fireEvent.click(await screen.findByRole("button", { name: "Acciones de Supervisor de Almacén" }));
  fireEvent.click(await screen.findByRole("menuitem", { name: "Iniciar reemplazo" }));
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.mocked(listDraftsAction).mockResolvedValue({ ok: true, items: [row], nextCursor: null });
  vi.mocked(getLifecycleAction).mockResolvedValue({ ok: true, etag: "lifecycle-tag", data: startable });
  vi.mocked(loadBoardAction).mockResolvedValue({ ok: true, data: sourceBoard() });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("«Acciones» → «Iniciar reemplazo» reads the source board and opens the dialog without preselection", async () => {
  render(<VacancyPortfolio />);
  expect(loadBoardAction).not.toHaveBeenCalled();
  await chooseStart();
  const dialog = await screen.findByRole("dialog", { name: "Iniciar reemplazo" });
  expect(loadBoardAction).toHaveBeenCalledExactlyOnceWith(original);
  expect(within(dialog).getByTestId("draft")).toHaveTextContent(original);
  expect(within(dialog).getByTestId("title")).toHaveTextContent("Supervisor de Almacén");
  expect(within(dialog).getByTestId("credit")).toHaveTextContent("sin preselección");
  expect(within(dialog).getByTestId("stages")).toHaveTextContent("Entrada,Revisión,Entrevista,Contratación");
  expect(within(dialog).getByTestId("unavailable")).toHaveTextContent("Ana Pérez:still_placed");
});
it("onStarted navigates to the new draft's pipeline and refreshes", async () => {
  render(<VacancyPortfolio />);
  await chooseStart();
  fireEvent.click(within(await screen.findByRole("dialog", { name: "Iniciar reemplazo" })).getByRole("button", { name: "Terminar" }));
  expect(router.push).toHaveBeenCalledExactlyOnceWith(`/empresa/vacantes/${newDraft}/pipeline`);
  expect(router.refresh).toHaveBeenCalledOnce();
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Iniciar reemplazo" })).not.toBeInTheDocument());
});
it("closing the dialog leaves the portfolio as it was", async () => {
  render(<VacancyPortfolio />);
  await chooseStart();
  fireEvent.click(within(await screen.findByRole("dialog", { name: "Iniciar reemplazo" })).getByRole("button", { name: "Cerrar" }));
  expect(screen.queryByRole("dialog", { name: "Iniciar reemplazo" })).not.toBeInTheDocument();
  expect(router.push).not.toHaveBeenCalled();
});
it("a failed board read explains it and opens nothing", async () => {
  vi.mocked(loadBoardAction).mockResolvedValue({ ok: false, reason: "no_response", reference: {} });
  render(<VacancyPortfolio />);
  await chooseStart();
  await waitFor(() => expect(notifyActionResult).toHaveBeenCalledWith(expect.objectContaining({ type: "error", title: "No pudimos abrir el reemplazo" })));
  expect(screen.queryByRole("dialog", { name: "Iniciar reemplazo" })).not.toBeInTheDocument();
});
it("a rejected board read is treated the same way", async () => {
  vi.mocked(loadBoardAction).mockRejectedValue(new Error("boom"));
  render(<VacancyPortfolio />);
  await chooseStart();
  await waitFor(() => expect(notifyActionResult).toHaveBeenCalledWith(expect.objectContaining({ type: "error" })));
  expect(screen.queryByRole("dialog", { name: "Iniciar reemplazo" })).not.toBeInTheDocument();
});
