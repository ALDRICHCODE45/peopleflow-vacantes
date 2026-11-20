import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { listDraftsAction } from "@/features/jobs/drafts/list/actions";
import type { DraftListRow } from "@/features/jobs/drafts/list/client";
import { VacancyPortfolio } from "./vacancy-portfolio";

// replacement-processes-v1 S6: «Reemplazo» badge on replacement rows, «N reemplazos» group under the original.
vi.mock("@/features/jobs/drafts/list/actions", () => ({ listDraftsAction: vi.fn() }));
vi.mock("@/components/feedback/notify", () => ({ notifyActionResult: vi.fn(), dismissActionResult: vi.fn() }));
const original = "123e4567-e89b-42d3-a456-426614174000";
const first = "223e4567-e89b-42d3-a456-426614174000";
const second = "323e4567-e89b-42d3-a456-426614174000";
const candidates = { total: 8, in_process: 0, discarded: 3, by_stage: [] };
const base: DraftListRow = { close_reason: "filled", close_reason_note: null, candidates, paused_at: null, closed_at: "2026-11-03T12:00:00Z", process_finished_at: "2026-11-03T12:00:00Z", id: original, status: "closed", process: "finished", published_at: "2026-10-01T12:00:00Z", title: "Supervisor de Almacén", work_mode: "onsite", work_schedule: "full_time", requester: null, team: { mode: "with_responsible", responsible: { id: original, name: "Sofía" }, members_count: 1, viewer_function: "responsible" }, version: "1", created_at: "2026-10-01T12:00:00Z", updated_at: "2026-11-03T12:00:00Z" };
const root = { ...base, kind: "original" as const, sequence: null, replacement_of: null, root_process_id: original, visibility: "public" as const };
const replacement = (id: string, sequence: number, patch: Partial<DraftListRow> = {}): DraftListRow => ({ ...base, id, title: "Supervisor de Almacén", status: "published", process: "active", close_reason: null, closed_at: null, process_finished_at: null, candidates: { total: 2, in_process: 2, discarded: 0, by_stage: [] }, updated_at: `2026-11-1${sequence}T12:00:00Z`, kind: "replacement", sequence, replacement_of: original, root_process_id: original, visibility: "private", ...patch });
beforeEach(() => {
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.resetAllMocks();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const rows = (container: HTMLElement) => Array.from(container.querySelectorAll("[data-pf-vacancy-row]")).map(node => node.getAttribute("data-pf-vacancy-row"));
function list(items: DraftListRow[], nested?: DraftListRow[]) {
  vi.mocked(listDraftsAction).mockImplementation(async input => ({ ok: true, items: input?.rootProcessId ? nested ?? items.filter(row => row.root_process_id === input.rootProcessId && row.kind === "replacement") : items, nextCursor: null }));
}

it("an old backend payload renders today's flat list: no badge, no group", async () => {
  list([{ ...base }, { ...base, id: first, title: "Chofer", status: "paused", process: "active", close_reason: null, closed_at: null, process_finished_at: null }]);
  const { container } = render(<VacancyPortfolio />); await screen.findByText("Chofer");
  expect(rows(container)).toHaveLength(2);
  expect(screen.queryByText("Reemplazo")).not.toBeInTheDocument(); expect(screen.queryByRole("button", { name: /reemplazo/ })).not.toBeInTheDocument();
});
it("badges a replacement row «Reemplazo» and «Privada» when its original is not on screen", async () => {
  list([replacement(first, 1)]);
  const { container } = render(<VacancyPortfolio />); await screen.findByText("Supervisor de Almacén");
  expect(rows(container)).toEqual([first]);
  const row = container.querySelector(`[data-pf-vacancy-row="${first}"]`) as HTMLElement;
  expect(within(row).getByText("Reemplazo")).toHaveAttribute("data-slot", "badge");
  expect(within(row).getByText("Privada")).toHaveAttribute("data-slot", "badge");
});
it("a public replacement has no «Privada» badge", async () => {
  list([replacement(first, 1, { visibility: "public" })]);
  render(<VacancyPortfolio />); await screen.findByText("Reemplazo");
  expect(screen.queryByText("Privada")).not.toBeInTheDocument();
});
it("groups replacements under their original, collapsed, with the pluralised count", async () => {
  list([root, replacement(first, 1), replacement(second, 2, { status: "closed", process: "finished", close_reason: "filled" })]);
  const { container } = render(<VacancyPortfolio />);
  const toggle = await screen.findByRole("button", { name: "2 reemplazos" });
  expect(toggle).toHaveAttribute("aria-expanded", "false");
  expect(rows(container)).toEqual([original]);
  expect(listDraftsAction).not.toHaveBeenCalledWith(expect.objectContaining({ rootProcessId: expect.anything() }));
});
it("expanding loads the group with the root_process_id filter and summarises each replacement", async () => {
  list([root, replacement(first, 1)]);
  const { container } = render(<VacancyPortfolio />);
  const toggle = await screen.findByRole("button", { name: "1 reemplazo" });
  fireEvent.click(toggle);
  expect(toggle).toHaveAttribute("aria-expanded", "true");
  await waitFor(() => expect(listDraftsAction).toHaveBeenCalledWith({ rootProcessId: original, limit: 50 }));
  const group = container.querySelector(`[data-pf-replacement-group="${original}"]`) as HTMLElement;
  expect(within(group).getByText("Reemplazo")).toBeVisible(); expect(within(group).getByText("Privada")).toBeVisible();
  expect(group).toHaveTextContent("2 candidatos");
  expect(within(group).getByRole("link", { name: "Ver reemplazo" })).toHaveAttribute("href", `/empresa/vacantes/${first}/pipeline`);
  fireEvent.click(toggle);
  expect(container.querySelector("[data-pf-replacement-group]")).toBeNull();
});
it("the group falls back to the loaded rows and says so when the filtered read fails", async () => {
  vi.mocked(listDraftsAction).mockImplementation(async input => input?.rootProcessId ? { ok: false, reason: "no_response", reference: {} } : { ok: true, items: [root, replacement(first, 1)], nextCursor: null });
  const { container } = render(<VacancyPortfolio />);
  fireEvent.click(await screen.findByRole("button", { name: "1 reemplazo" }));
  expect(await screen.findByText("No pudimos actualizar los reemplazos.")).toBeVisible();
  expect(container.querySelector(`[data-pf-replacement-group="${original}"]`)).toHaveTextContent("Ver reemplazo");
});
it("a replacement whose original is filtered out of the results still shows on its own", async () => {
  list([root, replacement(first, 1)]);
  const { container } = render(<VacancyPortfolio />); await screen.findByRole("button", { name: "1 reemplazo" });
  fireEvent.click(screen.getByRole("tab", { name: /Activas/ }));
  await waitFor(() => expect(rows(container)).toEqual([first]));
  expect(screen.queryByRole("button", { name: /reemplazo$/ })).not.toBeInTheDocument();
});
