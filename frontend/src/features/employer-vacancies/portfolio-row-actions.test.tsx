import type { ComponentProps, ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { DraftListRow } from "@/features/jobs/drafts/list/client";
import { getLifecycleAction } from "@/features/vacancy-lifecycle/actions";
import { VacancyPortfolio } from "./vacancy-portfolio";
import { usePortfolioDrafts } from "./use-portfolio-drafts";

// A-F3/A-F4: a live vacancy's row menu leads back to the editor and out to the public page / sharing; titles open the pipeline (a draft's, its editor).
vi.mock("./use-portfolio-drafts", () => ({ usePortfolioDrafts: vi.fn(), DRAFT_LIST_MESSAGES: {} }));
vi.mock("@/features/jobs/drafts/list/actions", () => ({ listDraftsAction: vi.fn() }));
vi.mock("@/features/vacancy-lifecycle/actions", () => ({ getLifecycleAction: vi.fn(), transitionLifecycleAction: vi.fn() }));
vi.mock("@/components/feedback/notify", () => ({ notifyActionResult: vi.fn(), dismissActionResult: vi.fn() }));
vi.mock("@/components/ui/dropdown-menu", async () => {
  const React = await import("react");
  const Menu = React.createContext(false);
  const pass = ({ children }: { children?: ReactNode }) => <>{children}</>;
  return {
    DropdownMenu: ({ children, onOpenChange }: { children: ReactNode; onOpenChange?: (open: boolean) => void }) => { const [open, setOpen] = React.useState(false); return <Menu.Provider value={open}><div onClick={() => { if (!open) onOpenChange?.(true); setOpen(true); }}>{children}</div></Menu.Provider>; },
    DropdownMenuTrigger: ({ render: trigger, children }: { render: ReactElement; children: ReactNode }) => React.cloneElement(trigger, { "aria-haspopup": "menu", children } as ComponentProps<"button">),
    DropdownMenuContent: ({ children }: { children: ReactNode }) => React.useContext(Menu) ? <div role="menu">{children}</div> : null,
    DropdownMenuGroup: ({ children }: { children: ReactNode }) => <div role="group">{children}</div>,
    DropdownMenuSub: pass, DropdownMenuSubContent: ({ children }: { children: ReactNode }) => <div role="group" aria-label="Compartir">{children}</div>,
    DropdownMenuSubTrigger: ({ children }: { children: ReactNode }) => <button role="menuitem" aria-haspopup="menu">{children}</button>,
    DropdownMenuItem: ({ children, onClick, disabled, render }: ComponentProps<"button"> & { render?: ReactElement<Record<string, unknown>> }) => render
      ? React.cloneElement(render, { role: "menuitem", children }) : <button role="menuitem" disabled={disabled} onClick={onClick}>{children}</button>,
  };
});

const team = { mode: "with_responsible" as const, responsible: { id: "r", name: "Ana" }, members_count: 1, viewer_function: "responsible" as const };
const row = (patch: Partial<DraftListRow>): DraftListRow => ({
  id: "pub-1", title: "Ingeniero backend", status: "published", process: "active", candidates: { total: 0, in_process: 0, discarded: 0, by_stage: [] },
  work_mode: "remote", work_schedule: "full_time", requester: null, team, version: "1", published_at: "2026-03-09T15:00:00Z", paused_at: null, closed_at: null, process_finished_at: null,
  close_reason: null, close_reason_note: null, created_at: "2026-03-08T15:00:00Z", updated_at: "2026-03-09T15:00:00Z", ...patch,
});
const show = (patch: Partial<DraftListRow>) => {
  vi.mocked(usePortfolioDrafts).mockReturnValue({ items: [row(patch)], pending: false, failure: null, capped: false, retried: false, retry: vi.fn(), published: vi.fn(), madePublic: vi.fn(), lifecycleChanged: vi.fn() } as never);
  render(<VacancyPortfolio />);
  fireEvent.click(screen.getByRole("button", { name: /^Acciones de / }));
  return screen.findByRole("menu");
};
beforeEach(() => { vi.mocked(getLifecycleAction).mockResolvedValue({ ok: false, message: "x", reference: {} } as never); });
afterEach(cleanup);

it("a published public vacancy: «Editar publicación» to the editor, «Ver pipeline», «Ver página pública» in a new tab and «Compartir»", async () => {
  const menu = await show({});
  expect(within(menu).getByRole("menuitem", { name: "Editar publicación" })).toHaveAttribute("href", "/empresa/vacantes/borradores/pub-1");
  expect(within(menu).getByRole("menuitem", { name: "Ver pipeline" })).toHaveAttribute("href", "/empresa/vacantes/pub-1/pipeline");
  const publicPage = within(menu).getByRole("menuitem", { name: /Ver página pública/ });
  expect(publicPage).toHaveAttribute("href", "/vacantes/pub-1");
  expect(publicPage).toHaveAttribute("target", "_blank");
  expect(publicPage).toHaveAttribute("rel", "noopener noreferrer");
  expect(within(menu).getByRole("menuitem", { name: "Compartir" })).toBeInTheDocument();
  expect(within(screen.getByRole("group", { name: "Compartir" })).getAllByRole("menuitem").map(item => item.textContent)).toEqual(expect.arrayContaining(["Copiar enlace", "WhatsApp", "Correo", "LinkedIn"]));
});
it("an older backend without visibility counts as public", async () => {
  const menu = await show({ visibility: undefined });
  expect(within(menu).getByRole("menuitem", { name: /Ver página pública/ })).toBeInTheDocument();
});
it.each([
  ["a private replacement", { visibility: "private" as const }, ["Editar publicación", "Ver pipeline"]],
  ["a paused vacancy", { status: "paused" as const, paused_at: "2026-03-10T15:00:00Z" }, ["Editar publicación", "Ver pipeline"]],
  ["a closed vacancy", { status: "closed" as const, process: "finished" as const, closed_at: "2026-03-11T15:00:00Z", process_finished_at: "2026-03-12T15:00:00Z" }, ["Ver pipeline"]],
  ["a draft", { status: "draft" as const, process: null, candidates: null, published_at: null }, ["Continuar editando", "Ver pipeline"]],
])("%s has no public page and no share", async (_name, patch, labels) => {
  const menu = await show(patch);
  expect(within(menu).getAllByRole("menuitem").map(item => item.textContent)).toEqual(labels);
  expect(within(menu).queryByRole("menuitem", { name: "Compartir" })).not.toBeInTheDocument();
});
it("titles open the pipeline; a draft's title opens its editor", () => {
  vi.mocked(usePortfolioDrafts).mockReturnValue({ items: [row({}), row({ id: "draft-1", title: "Borrador", status: "draft", process: null, candidates: null, published_at: null })], pending: false, failure: null, capped: false, retried: false, retry: vi.fn(), published: vi.fn(), madePublic: vi.fn(), lifecycleChanged: vi.fn() } as never);
  render(<VacancyPortfolio />);
  expect(screen.getByRole("link", { name: "Ingeniero backend" })).toHaveAttribute("href", "/empresa/vacantes/pub-1/pipeline");
  expect(screen.getByRole("link", { name: "Borrador" })).toHaveAttribute("href", "/empresa/vacantes/borradores/draft-1");
});
it("shows the stat cards in two columns on phones", () => {
  vi.mocked(usePortfolioDrafts).mockReturnValue({ items: [row({})], pending: false, failure: null, capped: false, retried: false, retry: vi.fn(), published: vi.fn(), madePublic: vi.fn(), lifecycleChanged: vi.fn() } as never);
  const { container } = render(<VacancyPortfolio />);
  const summary = container.querySelector("[data-pf-vacancy-summary]")!;
  expect(summary).toHaveClass("grid-cols-2");
  expect(summary).not.toHaveClass("grid-cols-1");
  expect(container.querySelector('[data-pf-vacancy-metric="closed"]')).toHaveClass("last:col-span-2");
});
it("«Copiar enlace» in the row's Compartir submenu copies the absolute public URL tagged as shared", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  const menu = await show({});
  fireEvent.click(within(within(menu).getByRole("group", { name: "Compartir" })).getByRole("menuitem", { name: "Copiar enlace" }));
  await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/vacantes/pub-1?origen=compartido`));
  Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
});
