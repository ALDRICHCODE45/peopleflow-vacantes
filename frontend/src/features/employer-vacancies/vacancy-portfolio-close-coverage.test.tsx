import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { DraftListRow } from "@/features/jobs/drafts/list/client";
import { getLifecycleAction } from "@/features/vacancy-lifecycle/actions";
import { VacancyPortfolio } from "./vacancy-portfolio";
import { usePortfolioDrafts } from "./use-portfolio-drafts";

vi.mock("./use-portfolio-drafts", () => ({ usePortfolioDrafts: vi.fn(), DRAFT_LIST_MESSAGES: {} }));
vi.mock("@/features/vacancy-lifecycle/actions", () => ({ getLifecycleAction: vi.fn(), transitionLifecycleAction: vi.fn() }));
vi.mock("@/components/feedback/notify", () => ({ notifyActionResult: vi.fn() }));
// Exercise the open/load boundary independently of floating-ui positioning in jsdom.
vi.mock("@/components/ui/dropdown-menu", async importOriginal => ({
  ...(await importOriginal<object>()),
  DropdownMenu: ({ children, onOpenChange }: { children: ReactNode; onOpenChange: (open: boolean) => void }) => <div><button onClick={() => onOpenChange(true)}>Abrir</button>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  DropdownMenuContent: ({ children }: { children: ReactNode }) => <div role="menu">{children}</div>,
  DropdownMenuGroup: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({ children, onClick, disabled }: { children: ReactNode; onClick?: () => void; disabled?: boolean }) => <button role="menuitem" onClick={onClick} disabled={disabled}>{children}</button>,
}));

const row = (coverage: DraftListRow["coverage"]): DraftListRow => ({
  id: "backend-real", title: "Ingeniero backend", status: "published", process: "active", candidates: null,
  work_mode: "remote", work_schedule: "full_time", requester: null,
  team: { mode: "with_responsible", responsible: { id: "recruiter-real", name: "Ana" }, members_count: 2, viewer_function: "collaborator" }, version: "1",
  published_at: "2026-03-09T15:00:00Z", paused_at: null, closed_at: null, process_finished_at: null,
  close_reason: null, close_reason_note: null, created_at: "2026-03-08T15:00:00Z", updated_at: "2026-03-09T15:00:00Z", coverage,
  visibility: "private", // no public page, so no share submenu (which needs the real menu context)
});
const lifecycle = { close_reason: null, close_reason_note: null, publication: "published" as const, process: "active" as const, version: "1", published_at: null, paused_at: null, closed_at: null, process_finished_at: null, allowed_actions: ["close"] };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getLifecycleAction).mockResolvedValue({ ok: true, etag: "etag", data: lifecycle } as never);
});
afterEach(cleanup);

async function openCloseDialog(coverage: DraftListRow["coverage"]) {
  vi.mocked(usePortfolioDrafts).mockReturnValue({ items: [row(coverage)], pending: false, failure: null, capped: false, retried: false, retry: vi.fn(), published: vi.fn(), madePublic: vi.fn(), lifecycleChanged: vi.fn() } as never);
  render(<VacancyPortfolio />);
  fireEvent.click(screen.getByText("Abrir"));
  fireEvent.click(await screen.findByRole("menuitem", { name: "Cerrar" }));
  return screen.findByRole("radio", { name: "Cubierta" });
}

describe("close dialog opened from a vacancy list row", () => {
  it("disables «Cubierta» with its reason when the row's live coverage is incomplete", async () => {
    const filled = await openCloseDialog({ covered: 1, required: 2 });
    expect(filled).toHaveAttribute("aria-disabled", "true");
    expect(filled).toHaveAccessibleDescription("Hay 1 de 2 posiciones cubiertas.");
  });
  it("keeps «Cubierta» available when the row's coverage is complete or the row carries none", async () => {
    expect(await openCloseDialog({ covered: 2, required: 2 })).not.toHaveAttribute("aria-disabled", "true");
    cleanup();
    expect(await openCloseDialog(undefined)).not.toHaveAttribute("aria-disabled", "true");
  });
});
