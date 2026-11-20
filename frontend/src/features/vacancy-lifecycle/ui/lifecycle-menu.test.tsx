import type { ReactNode } from "react";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { LifecycleActionsMenu } from "./lifecycle-actions-menu";
import { getLifecycleAction } from "../actions";
vi.mock("../actions", () => ({ getLifecycleAction: vi.fn(), transitionLifecycleAction: vi.fn() }));
vi.mock("@/components/feedback/notify", () => ({ notifyActionResult: vi.fn() }));
// Exercise the open/load boundary independently of floating-ui positioning in jsdom.
vi.mock("@/components/ui/dropdown-menu", () => ({
 DropdownMenu: ({ children, onOpenChange }: { children: ReactNode; onOpenChange: (open: boolean) => void }) => <div><button onClick={() => onOpenChange(true)}>Abrir</button>{children}</div>,
 DropdownMenuTrigger: ({ children }: { children: ReactNode }) => <span>{children}</span>,
 DropdownMenuContent: ({ children }: { children: ReactNode }) => <div role="menu">{children}</div>,
 DropdownMenuGroup: ({ children }: { children: ReactNode }) => <div>{children}</div>,
 DropdownMenuItem: ({ children, onClick, disabled }: { children: ReactNode; onClick?: () => void; disabled?: boolean }) => <button role="menuitem" onClick={onClick} disabled={disabled}>{children}</button>,
}));
beforeEach(() => vi.resetAllMocks()); afterEach(cleanup);
it.each([["pause", "Pausar"], ["resume", "Reanudar"], ["close", "Cerrar"], ["finish_process", "Finalizar proceso"], ["reopen", "Reabrir"]] as const)("shows only server-allowed %s", async (action, label) => {
 vi.mocked(getLifecycleAction).mockResolvedValue({ ok: true, etag: "etag", data: { close_reason: null, close_reason_note: null, publication: "closed", process: "active", version: "1", published_at: null, paused_at: null, closed_at: null, process_finished_at: null, allowed_actions: [action] } });
 render(<LifecycleActionsMenu draftId="id" title="Analista" onChanged={vi.fn()} />);
 expect(getLifecycleAction).not.toHaveBeenCalled(); fireEvent.click(screen.getByText("Abrir"));
 expect(await screen.findByRole("menuitem", { name: label })).toBeVisible(); expect(screen.getAllByRole("menuitem")).toHaveLength(1);
});
it("non-actors receive no lifecycle actions", async () => {
 vi.mocked(getLifecycleAction).mockResolvedValue({ ok: true, etag: "etag", data: { close_reason: null, close_reason_note: null, publication: "published", process: "active", version: "1", published_at: null, paused_at: null, closed_at: null, process_finished_at: null, allowed_actions: [] } });
 render(<LifecycleActionsMenu draftId="id" title="Analista" onChanged={vi.fn()} />); fireEvent.click(screen.getByText("Abrir"));
 await waitFor(() => expect(getLifecycleAction).toHaveBeenCalled()); expect(screen.queryAllByRole("menuitem")).toHaveLength(0);
});
it("shows mapped permission failure without actions", async () => {
 vi.mocked(getLifecycleAction).mockResolvedValue({ ok: false, reason: "forbidden", message: "No tienes permiso para cambiar el estado de esta vacante.", reference: { status: 403 } });
 render(<LifecycleActionsMenu draftId="id" title="Analista" onChanged={vi.fn()} />); fireEvent.click(screen.getByText("Abrir"));
 expect(await screen.findByText(/No tienes permiso/)).toBeVisible(); expect(screen.queryAllByRole("menuitem")).toHaveLength(0);
});

// replacement-processes-v1 S2: a closed-covered vacancy starts a replacement instead of reopening.
const closed = { close_reason: "filled" as const, close_reason_note: null, publication: "closed" as const, process: "finished" as const, version: "3", published_at: null, paused_at: null, closed_at: null, process_finished_at: null };
function open(data: Record<string, unknown>, onStartReplacement?: (creditId?: string) => void) {
 vi.mocked(getLifecycleAction).mockResolvedValue({ ok: true, etag: "etag", data: { ...closed, allowed_actions: [], ...data } as never });
 render(<LifecycleActionsMenu draftId="id" title="Analista" onChanged={vi.fn()} onStartReplacement={onStartReplacement} />); fireEvent.click(screen.getByText("Abrir"));
}
it("offers «Iniciar reemplazo» instead of «Reabrir» when closed covered", async () => {
 const start = vi.fn();
 open({ kind: "original", closed_covered: true, can_start_replacement: true, start_replacement_blocker: null, startable_credits_count: 1 }, start);
 fireEvent.click(await screen.findByRole("menuitem", { name: "Iniciar reemplazo" }));
 expect(start).toHaveBeenCalledExactlyOnceWith(); expect(screen.queryByRole("menuitem", { name: "Reabrir" })).not.toBeInTheDocument();
});
it("keeps «Reabrir» only when the backend allows it, even next to «Iniciar reemplazo»", async () => {
 open({ kind: "original", closed_covered: false, can_start_replacement: true, allowed_actions: ["reopen"] }, vi.fn());
 expect(await screen.findByRole("menuitem", { name: "Reabrir" })).toBeVisible();
 expect(screen.getByRole("menuitem", { name: "Iniciar reemplazo" })).toBeVisible();
});
it("never invents «Reabrir» from the closed-covered flag", async () => {
 open({ kind: "original", closed_covered: true, can_start_replacement: false, start_replacement_blocker: "no_startable_credits", allowed_actions: ["finish_process"] }, vi.fn());
 expect(await screen.findByRole("menuitem", { name: "Finalizar proceso" })).toBeVisible();
 expect(screen.queryByRole("menuitem", { name: "Reabrir" })).not.toBeInTheDocument(); expect(screen.queryByRole("menuitem", { name: "Iniciar reemplazo" })).not.toBeInTheDocument();
});
it("hides «Iniciar reemplazo» without a handler (nothing to open)", async () => {
 open({ kind: "original", can_start_replacement: true });
 await waitFor(() => expect(getLifecycleAction).toHaveBeenCalled()); expect(screen.queryAllByRole("menuitem")).toHaveLength(0);
});
it("an old backend payload keeps today's menu: «Reabrir», no replacement item", async () => {
 open({ allowed_actions: ["reopen"] }, vi.fn());
 expect(await screen.findByRole("menuitem", { name: "Reabrir" })).toBeVisible(); expect(screen.getAllByRole("menuitem")).toHaveLength(1);
});
