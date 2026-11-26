import "@testing-library/jest-dom/vitest";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("../actions", () => ({
  getUnreadCountAction: vi.fn(), listNotificationsAction: vi.fn(), markReadAction: vi.fn(), markUnreadAction: vi.fn(),
  markAllReadAction: vi.fn(), getFacetsAction: vi.fn(),
}));
vi.mock("@/components/ui/popover", async () => (await import("./test-popover")).popoverModule());
vi.mock("next/link", async () => {
  const { forwardRef, createElement } = await import("react");
  type Props = { href: string; onClick?: (event: { preventDefault(): void }) => void };
  return { default: forwardRef<HTMLAnchorElement, Props>(({ href, onClick, ...props }, ref) =>
    createElement("a", { ...props, ref, href, onClick: (event: { preventDefault(): void }) => { onClick?.(event); event.preventDefault(); } })) };
});
import { getFacetsAction, getUnreadCountAction, listNotificationsAction, markAllReadAction } from "../actions";
import { jobId, notificationPage, otherJobId } from "../test-fixtures";
import { facets, marked, ok, openInbox, stubBrowserApis } from "./inbox-harness";

const list = vi.mocked(listNotificationsAction);
const getFacets = vi.mocked(getFacetsAction);
const popover = () => screen.findByRole("dialog", { name: "Filtrar notificaciones" });
const closed = () => waitFor(() => expect(screen.queryByRole("dialog", { name: "Filtrar notificaciones" })).toBeNull());
const showResults = (panel: HTMLElement) => within(panel).getByRole("button", { name: /^Ver (\d+ )?notificaci/ });
const box = (scope: HTMLElement, name: RegExp | string) => within(scope).getByRole("checkbox", { name });
const deliveries = ["delivery_due_soon", "delivery_overdue", "assignment_deadline_due_soon", "assignment_deadline_overdue"];
const jobUuid = (n: number) => `50000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

beforeEach(() => {
  vi.resetAllMocks();
  stubBrowserApis();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-26T20:00:00Z"));
  vi.mocked(getUnreadCountAction).mockResolvedValue({ ok: true, data: { unread_count: 2, unread_notifications: 4 } });
  list.mockResolvedValue(ok());
  getFacets.mockResolvedValue(facets({
    types: [{ type: "application_received", count: 2 }, { type: "delivery_overdue", count: 1 }, { type: "assignment_deadline_due_soon", count: 2 }],
  }));
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

async function openFilters() {
  const opened = await openInbox();
  await opened.user.click(within(opened.dialog).getByRole("button", { name: /^Filtrar/ }));
  const panel = await popover();
  await within(panel).findByRole("checkbox", { name: /Analista de nómina/ });
  return { ...opened, panel };
}

it("opens a «Filtrar» popover with type and vacancy counts from the tab's facets", async () => {
  const { panel } = await openFilters();
  expect(getFacets).toHaveBeenCalledWith("unread");
  const types = within(panel).getByRole("group", { name: "Tipo" });
  expect(box(types, "Todos 5")).toBeChecked();
  expect(box(types, "Postulaciones 2")).not.toBeChecked();
  expect(box(types, "Entregas 3")).toBeInTheDocument();
  expect(box(types, "Vacantes y equipo 0")).toBeInTheDocument();
  expect(box(types, "Pruebas 0")).toBeInTheDocument();
  const jobs = within(panel).getByRole("group", { name: "Vacante" });
  expect(box(jobs, "Analista de nómina 3")).toBeInTheDocument();
  expect(box(jobs, "Vacante sin título 1")).toBeInTheDocument();
  expect(within(panel).queryByText(/Mostrando/)).toBeNull();
  expect(within(panel).getByRole("button", { name: "Limpiar" })).toBeDisabled();
});

it("reads the facets of «Todas» on that tab", async () => {
  const { user, dialog } = await openInbox();
  await user.click(within(dialog).getByRole("tab", { name: "Todas" }));
  await waitFor(() => expect(list).toHaveBeenLastCalledWith({ state: "all" }));
  await user.click(within(dialog).getByRole("button", { name: /^Filtrar/ }));
  await popover();
  expect(getFacets).toHaveBeenCalledWith("all");
});

it("applies a type and a vacancy at once, then summarises them under the tabs", async () => {
  const { user, dialog, panel } = await openFilters();
  await user.click(box(panel, /^Postulaciones/));
  await waitFor(() => expect(list).toHaveBeenLastCalledWith({ state: "unread", types: ["application_received"] }));
  await user.click(box(panel, /^Analista de nómina/));
  await waitFor(() => expect(list).toHaveBeenLastCalledWith({ state: "unread", types: ["application_received"], jobIds: [jobId] }));
  expect(box(panel, /^Todos/)).not.toBeChecked();
  expect(within(dialog).getByRole("button", { name: "Filtrar, 2 filtros activos" })).toBeInTheDocument();
  await user.click(showResults(panel));
  await closed();
  expect(within(dialog).getByRole("status")).toHaveTextContent("Postulaciones · Analista de nómina");
});

it("counts the results in «Ver N notificaciones» when the whole list is loaded", async () => {
  const { panel } = await openFilters();
  expect(within(panel).getByRole("button", { name: "Ver 3 notificaciones" })).toBeInTheDocument();
});

it("summarises several values as «2 tipos · 2 vacantes»", async () => {
  const { user, dialog, panel } = await openFilters();
  await user.click(box(panel, /^Entregas/));
  await user.click(box(panel, /^Pruebas/));
  await user.click(box(panel, /^Analista de nómina/));
  await user.click(box(panel, /^Vacante sin título/));
  await waitFor(() => expect(list).toHaveBeenLastCalledWith({
    state: "unread", types: [...deliveries, "psychometric_completed", "psychometric_pending"], jobIds: [jobId, otherJobId],
  }));
  expect(within(dialog).getByRole("status")).toHaveTextContent("2 tipos · 2 vacantes");
});

it("«Todos» clears the type selection", async () => {
  const { user, panel } = await openFilters();
  await user.click(box(panel, /^Entregas/));
  await waitFor(() => expect(list).toHaveBeenLastCalledWith({ state: "unread", types: deliveries }));
  await user.click(box(panel, /^Todos/));
  await waitFor(() => expect(list).toHaveBeenLastCalledWith({ state: "unread" }));
});

it("«Limpiar» in the summary removes every filter and returns focus to «Filtrar»", async () => {
  const { user, dialog, panel } = await openFilters();
  await user.click(box(panel, /^Postulaciones/));
  await user.click(showResults(panel));
  await closed();
  await user.click(within(dialog).getByRole("button", { name: "Limpiar" }));
  await waitFor(() => expect(list).toHaveBeenLastCalledWith({ state: "unread" }));
  expect(within(dialog).queryByText("Postulaciones")).toBeNull();
  expect(within(dialog).getByRole("button", { name: "Filtrar" })).toHaveFocus();
});

it("shows «Sin resultados» with «Limpiar filtros» when nothing matches", async () => {
  const { user, dialog, panel } = await openFilters();
  list.mockResolvedValue(ok(notificationPage({ attention: [], attention_total: 0, items: [] })));
  await user.click(box(panel, /^Pruebas/));
  await user.click(showResults(panel));
  expect(await within(dialog).findByRole("heading", { name: "Sin resultados" })).toBeInTheDocument();
  expect(within(dialog).getByText("Ninguna notificación sin leer coincide con Pruebas. Los filtros se conservan para que ajustes uno.")).toBeInTheDocument();
  list.mockResolvedValue(ok());
  await user.click(within(dialog).getByRole("button", { name: "Limpiar filtros" }));
  await waitFor(() => expect(list).toHaveBeenLastCalledWith({ state: "unread" }));
  await within(dialog).findByRole("heading", { name: "Hoy" });
});

it("searches vacancies and says when none matches", async () => {
  const { user, panel } = await openFilters();
  await user.type(within(panel).getByRole("searchbox", { name: "Buscar vacante" }), "nomina");
  expect(box(panel, /^Analista de nómina/)).toBeInTheDocument();
  expect(within(panel).queryByRole("checkbox", { name: /Vacante sin título/ })).toBeNull();
  await user.type(within(panel).getByRole("searchbox", { name: "Buscar vacante" }), "zzz");
  expect(within(panel).getByText("Ninguna vacante coincide con «nominazzz».")).toBeInTheDocument();
});

it("allows at most 20 vacancies and says the list is cut", async () => {
  const jobs = Array.from({ length: 21 }, (_, i) => ({ job_id: jobUuid(i + 1), title: `Vacante ${String(i + 1).padStart(2, "0")}`, count: 1 }));
  getFacets.mockResolvedValue(facets({ jobs, jobs_total: 30 }));
  const { user, dialog } = await openInbox();
  await user.click(within(dialog).getByRole("button", { name: /^Filtrar/ }));
  const panel = await popover();
  await within(panel).findByRole("checkbox", { name: /Vacante 01/ });
  expect(within(panel).getByText("Mostrando 21 de 30 vacantes")).toBeInTheDocument();
  for (let i = 1; i <= 20; i++) await user.click(box(panel, new RegExp(`^Vacante ${String(i).padStart(2, "0")}`)));
  await waitFor(() => expect(list).toHaveBeenLastCalledWith({ state: "unread", jobIds: jobs.slice(0, 20).map(j => j.job_id) }));
  expect(box(panel, /^Vacante 21/)).toHaveAttribute("aria-disabled", "true");
  expect(box(panel, /^Vacante 20/)).not.toHaveAttribute("aria-disabled", "true");
  await user.click(box(panel, /^Vacante 21/));
  expect(box(panel, /^Vacante 21/)).not.toBeChecked();
  expect(within(panel).getByText("Puedes elegir hasta 20 vacantes.")).toBeInTheDocument();
});

it("marks all read with the active filters", async () => {
  vi.mocked(markAllReadAction).mockResolvedValue(marked({ affected_notifications: 2, unread_count: 0 }));
  const { user, dialog, panel } = await openFilters();
  await user.click(box(panel, /^Entregas/));
  await user.click(box(panel, /^Analista de nómina/));
  await waitFor(() => expect(list).toHaveBeenLastCalledWith({ state: "unread", types: deliveries, jobIds: [jobId] }));
  await user.click(showResults(panel));
  await within(dialog).findByRole("heading", { name: "Hoy" });
  vi.setSystemTime(new Date("2026-11-26T20:09:00Z"));
  await user.click(within(dialog).getByRole("button", { name: "Marcar todo como leído" }));
  expect(markAllReadAction).toHaveBeenCalledWith({ types: deliveries, jobIds: [jobId], before: "2026-11-26T18:41:10Z" });
});

