import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { AssignmentHistory } from "./history";
import { HistoryTable } from "./history-table";
import { AssignmentError, type Assignment, type AssignmentClient } from "./client";

// Same jsdom-only positioner shell used by psychometrics/profile/help.test.tsx.
vi.mock("@/components/ui/popover", async importOriginal => ({
  ...await importOriginal<typeof import("@/components/ui/popover")>(),
  PopoverContent: ({ children }: { children?: ReactNode }) => children ? <div role="dialog" aria-label="Ayuda">{children}</div> : null,
}));
vi.mock("@/components/ui/dropdown-menu", async () => (await import("@/components/data-table/test-menu")).menuDouble);
vi.mock("@/components/ui/tooltip", async () => (await import("@/components/data-table/test-menu")).tooltipDouble);
afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); window.history.replaceState(null, "", "/"); });
const item = (overrides: Partial<Assignment> = {}): Assignment => ({ vacancy_title: "Analista contable", draft_id: "draft-1", requester: { kind: "client", name: "Grupo Norte" }, vacancy_status: { publication: "published", process: "active" }, business_days_in_tramo: 8, delivery_target: 5, deadline_result: "on_time", deadline_delta_business_days: 2, functions: [{ function: "collaborator", started_at: "2026-11-02T18:00:00Z", ended_at: "2026-11-04T18:00:00Z" }, { function: "responsible", started_at: "2026-11-04T18:00:00Z", ended_at: null }], started_at: "2026-11-02T18:00:00Z", ended_at: null, end_cause: null, effective_deadline: "2026-11-20", delivered_in_tramo: 3, placements: { direct: 1, participant: 1, shared: 1 }, ...overrides });
const clientFor = (items: Assignment[]): AssignmentClient => ({ getHistory: vi.fn().mockResolvedValue({ items, next_cursor: null }) });
const desktop = () => within(screen.getByRole("table"));
it("does not remeasure text when tooltip geometry alternates between overflow and fitting", () => {
  // Model the two measured DOM branches: plain text overflows, tooltip trigger fits.
  // Bound the old effect loop so RED fails promptly instead of hanging the runner.
  let reads = 0;
  vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockImplementation(function (this: HTMLElement) {
    if (this.tagName !== "SPAN" || this.textContent !== "Software Developer") return 0;
    if (++reads > 12) throw new Error("Overflow measurement feedback loop");
    return this.hasAttribute("tabindex") ? 80 : 300;
  });
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(100);
  render(<HistoryTable items={[item({ vacancy_title: "Software Developer" })]} loading={false} footer={null} />);
  expect(reads).toBe(0);
  expect(desktop().getByText("Software Developer")).toHaveClass("whitespace-normal", "break-words", "line-clamp-2");
});
it("wraps every cell and confines long previous functions to their own column", () => {
  const functions: Assignment["functions"] = [
    { function: "collaborator", started_at: "2026-11-02T18:00:00Z", ended_at: "2026-11-03T18:00:00Z" },
    { function: "member", started_at: "2026-11-03T18:00:00Z", ended_at: "2026-11-04T18:00:00Z" },
    { function: "responsible", started_at: "2026-11-04T18:00:00Z", ended_at: null },
  ];
  render(<HistoryTable items={[item({ functions })]} loading={false} footer={null} />);
  expect(desktop().getByText("antes Colaborador, Miembro")).toHaveClass("max-w-full", "whitespace-normal", "break-words");
  const table = screen.getByRole("table");
  expect(table.querySelector("tbody .truncate")).toBeNull();
  expect(table.closest("[data-history-layout]")).toHaveClass("[&_td]:whitespace-normal", "[&_td]:break-words");
});
it("shows only the Sin plazo badge for none on desktop and mobile", () => {
  render(<HistoryTable items={[item({ deadline_result: "none", effective_deadline: null, deadline_delta_business_days: null })]} loading={false} footer={null} />);
  const cell = desktop().getByText("Sin plazo").closest("td")!;
  expect(cell).toHaveTextContent(/^Sin plazo$/);
  expect(screen.queryByText("Sin dato")).not.toBeInTheDocument();
  expect(within(screen.getByRole("list", { name: "Vacantes en tarjetas" })).getByText("Sin plazo")).toBeInTheDocument();
});
it("fits eight default columns within 1300px and marks the ghost link as navigation", () => {
  render(<HistoryTable items={[item()]} loading={false} footer={null} />);
  const table = screen.getByRole("table");
  expect(parseFloat(table.style.minWidth)).toBeLessThanOrEqual(1300);
  for (const name of ["Entregas", "Placements"]) expect(parseFloat(desktop().getByRole("columnheader", { name }).style.width)).toBeGreaterThanOrEqual(120);
  const link = desktop().getByRole("link", { name: "Abrir vacante" });
  expect(link.querySelector('svg[data-icon="inline-end"]')).toHaveAttribute("aria-hidden", "true");
});
it("shows eight rich columns, Equipo identity, full results and the on-demand help", async () => {
  const { container } = render(<AssignmentHistory client={clientFor([item()])} />);
  await screen.findByRole("table");
  for (const name of ["Vacante", "Tu función", "Periodo", "Estado", "Plazo", "Entregas", "Placements", "Acción"]) expect(desktop().getByRole("columnheader", { name })).toBeInTheDocument();
  for (const text of ["Analista contable", "Cliente · Grupo Norte", "Responsable", "antes Colaborador", "Desde el 2 nov 2026", "8 días hábiles", "En la vacante", "Publicada", "20 nov 2026", "A tiempo", "2 días antes", "3 de 5", "1 directo · 1 compartido", "participaste en 1"]) expect(desktop().getByText(text)).toBeInTheDocument();
  expect(desktop().getByRole("link", { name: "Abrir vacante" })).toHaveAttribute("href", "/empresa/vacantes/draft-1/pipeline");
  expect(desktop().getByRole("progressbar")).toHaveAttribute("aria-valuenow", "60");
  expect(container.querySelector('[data-slot="avatar-fallback"]')).toHaveTextContent("AC");
  expect(screen.getByRole("button", { name: "Columnas" })).toBeInTheDocument();
  expect(screen.queryByText(/La meta de entrega es del equipo/)).not.toBeInTheDocument();
  fireEvent.click(desktop().getByRole("button", { name: "Ayuda: Plazo" }));
  expect(await screen.findByText(/La meta de entrega es del equipo/)).toHaveTextContent(/en la fecha del plazo o antes/);
});
it.each([["on_time", "A tiempo", 0, "0 días antes"], ["late", "Tarde", -3, "3 días tarde"], ["pending", "En curso", 5, "faltan 5 días"], ["unfinished", "Sin terminar", 1, "1 día antes"], ["not_applicable", "No aplica", null, null], ["none", "Sin plazo", null, null]] as const)("renders %s without inferring the result", async (deadline_result, label, delta, copy) => {
  render(<AssignmentHistory client={clientFor([item({ deadline_result, deadline_delta_business_days: delta })])} />);
  await screen.findByRole("table");
  expect(desktop().getByText(label)).toHaveAttribute("data-slot", "badge");
  if (copy) expect(desktop().getByText(copy)).toHaveClass("text-muted-foreground");
  else expect(desktop().getAllByRole("row")[1]).not.toHaveTextContent(/días antes|días tarde|faltan/);
});
it.each([["reassigned", "Te reasignaron", "draft", "Borrador"], ["left", "Saliste de la vacante", "published", "Publicada"], ["removed", "Te quitaron del equipo", "paused", "Pausada"], ["membership_ended", "Dejaste la empresa", "closed", "Cerrada"]] as const)("shows ended %s and vacancy %s without an access link", async (end_cause, label, publication, status) => {
  render(<AssignmentHistory client={clientFor([item({ draft_id: null, ended_at: "2026-11-12T18:00:00Z", end_cause, vacancy_status: { publication, process: "finished" } })])} />);
  await screen.findByRole("table");
  fireEvent.click(screen.getByRole("tab", { name: "Antes" }));
  expect(desktop().getByText(label)).toBeInTheDocument();
  expect(desktop().getByText(`${status} · proceso terminado`)).toBeInTheDocument();
  expect(desktop().getByText("Del 2 al 12 nov 2026")).toBeInTheDocument();
  expect(desktop().queryByRole("link")).not.toBeInTheDocument();
});
it("renders mobile cards with the same data, omits missing requester and zero placements", async () => {
  const { container } = render(<AssignmentHistory client={clientFor([item({ vacancy_title: null, draft_id: null, requester: null, effective_deadline: null, delivery_target: null, business_days_in_tramo: 1, delivered_in_tramo: 0, placements: { direct: 0, shared: 0, participant: 0 } })])} />);
  const cards = await screen.findByRole("list", { name: "Vacantes en tarjetas" });
  expect(cards).toHaveClass("md:hidden");
  expect(container.querySelector('[data-history-desktop]')).toHaveClass("hidden", "md:block");
  expect(within(cards).getByText("Sin título")).toBeInTheDocument();
  expect(within(cards).getByText("1 día hábil")).toBeInTheDocument();
  expect(within(cards).getByText("Sin entregas")).toBeInTheDocument();
  expect(cards).not.toHaveTextContent(/Cliente|Área|0 directo|0 compartido|participaste en 0/);
  expect(desktop().getByText("—")).toBeInTheDocument();
  expect(screen.queryByRole("link")).not.toBeInTheDocument();
});
it("shows area, target-free deliveries and only non-zero placement kinds", async () => {
  render(<AssignmentHistory client={clientFor([item({ requester: { kind: "internal_area", name: "Finanzas" }, delivery_target: null, delivered_in_tramo: 1, placements: { direct: 0, shared: 0, participant: 2 } })])} />);
  await screen.findByRole("table");
  expect(desktop().getByText("Área · Finanzas")).toBeInTheDocument();
  expect(desktop().getByText("1 entregado")).toBeInTheDocument();
  expect(desktop().getByText("participaste en 2")).toBeInTheDocument();
  expect(desktop().queryByRole("progressbar")).not.toBeInTheDocument();
  expect(desktop().getAllByRole("row")[1]).not.toHaveTextContent(/0 directo|0 compartido/);
});
it("paginates at the table foot, never opens a Sheet or double counts summary", async () => {
  const getHistory = vi.fn().mockResolvedValueOnce({ items: [item()], next_cursor: "opaque" }).mockResolvedValue({ items: [item({ vacancy_title: "Segunda" })], next_cursor: null });
  render(<AssignmentHistory client={{ getHistory }} />);
  fireEvent.click(await screen.findByRole("button", { name: "Cargar más" }));
  await waitFor(() => expect(desktop().getAllByRole("row")).toHaveLength(3));
  expect(getHistory.mock.calls).toEqual([[], ["opaque"], ["opaque"]]);
  expect(screen.queryByRole("button", { name: "Cargar más" })).not.toBeInTheDocument();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(within(screen.getByRole("region", { name: "Resumen de tu trabajo" })).getByText("Candidatos entregados").parentElement).toHaveTextContent("6");
});
it.each(["invalid_cursor", "read_failed", "unauthenticated"])("preserves pagination handling for %s", async code => {
  const getHistory = vi.fn().mockResolvedValueOnce({ items: [item()], next_cursor: "next" }).mockResolvedValueOnce({ items: [], next_cursor: null }).mockRejectedValueOnce(new AssignmentError(code, code === "unauthenticated" ? 401 : 400)).mockResolvedValue({ items: [], next_cursor: null });
  render(<AssignmentHistory client={{ getHistory }} />);
  fireEvent.click(await screen.findByRole("button", { name: "Cargar más" }));
  if (code === "unauthenticated") await screen.findByText("Tu sesión expiró");
  else if (code === "invalid_cursor") await screen.findByText("Todavía no has trabajado en vacantes");
  else { await screen.findByText("No pudimos cargar más vacantes"); expect(desktop().getByText("Analista contable")).toBeInTheDocument(); fireEvent.click(screen.getByRole("button", { name: "Reintentar" })); await waitFor(() => expect(screen.queryByText("No pudimos cargar más vacantes")).not.toBeInTheDocument()); }
});
it("keeps loading, empty and retry states", async () => {
  const getHistory = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue({ items: [], next_cursor: null });
  render(<AssignmentHistory client={{ getHistory }} />);
  expect(screen.getByText("Cargando tu historial")).toHaveAttribute("role", "status");
  fireEvent.click(await screen.findByRole("button", { name: "Reintentar" }));
  await screen.findByText("Todavía no has trabajado en vacantes");
  expect(screen.getByRole("link", { name: "Ver vacantes" })).toHaveAttribute("href", "/empresa/vacantes");
});
it("restarts invalid overview only once", async () => {
  const getHistory = vi.fn().mockResolvedValueOnce({ items: [], next_cursor: "stale" }).mockRejectedValueOnce(new AssignmentError("invalid_cursor", 400)).mockRejectedValue(new AssignmentError("invalid_cursor", 400));
  render(<AssignmentHistory client={{ getHistory }} />);
  await screen.findByRole("button", { name: "Reintentar" }); expect(getHistory).toHaveBeenCalledTimes(3);
});
