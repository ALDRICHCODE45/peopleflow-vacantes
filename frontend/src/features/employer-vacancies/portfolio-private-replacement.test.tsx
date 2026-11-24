import type { ComponentProps, ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { listDraftsAction } from "@/features/jobs/drafts/list/actions";
import type { DraftListRow } from "@/features/jobs/drafts/list/client";
import { loadDraftForEditAction } from "@/features/jobs/drafts/reopen/load";
import { loadDraftPublicationAction, publishDraftAction } from "@/features/jobs/drafts/pipeline/publication-actions";
import { loadDraftDeliveryAction } from "@/features/jobs/drafts/pipeline/delivery-actions";
import { loadDraftPipelineAction } from "@/features/jobs/drafts/pipeline/actions";
import { draftEditSeedFromRead } from "@/features/jobs/drafts/reopen/seed";
import { filledDraftRead } from "@/features/jobs/drafts/reopen/test-fixture";
import { getLifecycleAction } from "@/features/vacancy-lifecycle/actions";
import type { Lifecycle } from "@/features/vacancy-lifecycle/model";
import { VacancyPortfolio } from "./vacancy-portfolio";

// replacement-processes S5 «publish later» from the portfolio row: the private replacement's «Acciones» offers «Publicar» (contract D4: `publish` in allowed_actions,
// routed to the existing `POST V/publication`), and the row then loses «Privada · sin publicar» without moving its process clock.
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/features/jobs/drafts/list/actions", () => ({ listDraftsAction: vi.fn() }));
vi.mock("@/features/jobs/drafts/reopen/load", () => ({ loadDraftForEditAction: vi.fn() }));
vi.mock("@/features/jobs/drafts/pipeline/publication-actions", () => ({ loadDraftPublicationAction: vi.fn(), publishDraftAction: vi.fn() }));
vi.mock("@/features/jobs/drafts/pipeline/delivery-actions", () => ({ loadDraftDeliveryAction: vi.fn() }));
vi.mock("@/features/jobs/drafts/pipeline/actions", () => ({ loadDraftPipelineAction: vi.fn() }));
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
    // «Compartir» submenu of a public row (A-F4): rendered inline, not under test here.
    DropdownMenuSub: ({ children }: { children: ReactNode }) => <>{children}</>,
    DropdownMenuSubTrigger: ({ children }: { children: ReactNode }) => <button role="menuitem">{children}</button>,
    DropdownMenuSubContent: ({ children }: { children: ReactNode }) => <div role="group">{children}</div>,
    DropdownMenuItem: ({ children, onClick, disabled, render }: ComponentProps<"button"> & { render?: ReactElement<Record<string, unknown>> }) => render
      ? React.cloneElement(render, { role: "menuitem", children }) : <button role="menuitem" disabled={disabled} onClick={onClick}>{children}</button>,
  };
});

const read = filledDraftRead();
const original = "223e4567-e89b-42d3-a456-426614174000";
const processStart = "2026-11-19T18:00:00Z";
const team = { mode: "with_responsible" as const, responsible: { id: original, name: "Sofía" }, members_count: 1, viewer_function: "responsible" as const };
const row = (patch: Partial<DraftListRow> = {}): DraftListRow => ({
  close_reason: null, close_reason_note: null, candidates: { total: 0, in_process: 0, discarded: 0, by_stage: [] }, paused_at: null, closed_at: null, process_finished_at: null,
  id: read.id, status: "published", process: "active", published_at: processStart, title: "Supervisor de Almacén", work_mode: "onsite", work_schedule: "full_time", requester: null, team,
  version: "1", created_at: processStart, updated_at: processStart, kind: "replacement", sequence: 1, replacement_of: original, root_process_id: original, visibility: "private", ...patch,
});
const lifecycle = (patch: Partial<Lifecycle> = {}): Lifecycle => ({
  close_reason: null, close_reason_note: null, publication: "published", process: "active", version: "1", published_at: processStart, paused_at: null, closed_at: null, process_finished_at: null,
  allowed_actions: ["pause", "close", "publish"], kind: "replacement", sequence: 1, replacement_of: original, root_process_id: original, visibility: "private", closed_covered: false,
  can_start_replacement: false, start_replacement_blocker: "source_not_closed", startable_credits_count: 0, active_replacement_id: null, ...patch,
});
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.mocked(loadDraftForEditAction).mockResolvedValue({ ok: true, seed: { ...draftEditSeedFromRead(read), lifecycle: lifecycle() }, identity: { draftId: read.id, etag: '"draft-etag"' } });
  vi.mocked(loadDraftPublicationAction).mockResolvedValue({ ok: true, publication: { status: "draft", publishedAt: null, missing: [] } });
  vi.mocked(loadDraftDeliveryAction).mockResolvedValue({ ok: true, etag: '"delivery"', delivery: { fulfilled: false, version: "1", cutoffStageId: read.id, targetQuantity: 1, commitmentDate: "2026-11-30", limits: { maxTargetQuantity: 999 }, calendar: { timeZone: "America/Mexico_City", today: "2026-11-19", minDate: "2026-11-19", maxDate: "2027-11-19", nonBusinessDates: [] } } });
  vi.mocked(loadDraftPipelineAction).mockResolvedValue({ ok: true, etag: '"pipeline"', pipeline: { retired: [], version: "1", stages: [{ id: read.id, kind: "new", name: "Nuevos" }], exit: { id: read.id, kind: "discarded", name: "Fuera" }, limits: { maxCustomStages: 3, nameMaxLength: 40 }, structure_locked: false } });
  vi.mocked(getLifecycleAction).mockResolvedValue({ ok: true, etag: "lifecycle-tag", data: lifecycle() });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const actions = () => screen.findByRole("button", { name: "Acciones de Supervisor de Almacén" });

it("S5: the row «Acciones» of a private replacement offers «Publicar»; publishing keeps the process date and drops «Privada · sin publicar»", async () => {
  vi.mocked(listDraftsAction).mockResolvedValue({ ok: true, items: [row()], nextCursor: null });
  vi.mocked(publishDraftAction).mockResolvedValue({ ok: true, publication: { id: read.id, status: "published", publishedAt: "2026-11-20T12:00:00Z" } });
  const { container } = render(<VacancyPortfolio />);
  const item = (await screen.findByText("Privada · sin publicar")).closest("[data-pf-vacancy-row]") as HTMLElement;
  fireEvent.click(await actions());
  fireEvent.click(await screen.findByRole("menuitem", { name: "Publicar" }));
  const confirm = await screen.findByRole("alertdialog", { name: `¿Publicar ${draftEditSeedFromRead(read).model.fields.title}?` });
  fireEvent.click(within(confirm).getByRole("button", { name: "Publicar vacante" }));
  await waitFor(() => expect(publishDraftAction).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ draftId: read.id, body: {} })));
  await waitFor(() => expect(screen.queryByText("Privada · sin publicar")).not.toBeInTheDocument());
  expect(screen.queryByText("Privada")).not.toBeInTheDocument();
  // The row's date is the process clock (19 Nov), never the moment of the publication (20 Nov).
  expect(item).toHaveTextContent("Publicada el 19 de noviembre de 2026");
  expect(container.querySelectorAll("[data-pf-vacancy-row]")).toHaveLength(1);
});
it("S5: a public replacement's menu has no «Publicar»", async () => {
  vi.mocked(listDraftsAction).mockResolvedValue({ ok: true, items: [row({ visibility: "public" })], nextCursor: null });
  vi.mocked(getLifecycleAction).mockResolvedValue({ ok: true, etag: "lifecycle-tag", data: lifecycle({ visibility: "public", allowed_actions: ["pause", "close"] }) });
  render(<VacancyPortfolio />);
  fireEvent.click(await actions());
  await screen.findByRole("menuitem", { name: "Pausar" });
  expect(screen.queryByRole("menuitem", { name: "Publicar" })).not.toBeInTheDocument();
});
it("S5: an old backend row (no visibility) never gets a «Publicar» of its own", async () => {
  const { kind, sequence, replacement_of, root_process_id, visibility, ...old } = row(); void kind; void sequence; void replacement_of; void root_process_id; void visibility;
  vi.mocked(listDraftsAction).mockResolvedValue({ ok: true, items: [old], nextCursor: null });
  vi.mocked(getLifecycleAction).mockResolvedValue({ ok: true, etag: "lifecycle-tag", data: lifecycle({ allowed_actions: ["pause", "close"] }) });
  render(<VacancyPortfolio />);
  fireEvent.click(await actions());
  await screen.findByRole("menuitem", { name: "Pausar" });
  expect(screen.queryByRole("menuitem", { name: "Publicar" })).not.toBeInTheDocument();
});
