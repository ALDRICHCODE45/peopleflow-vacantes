import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { AssignmentHistory } from "./history";
import { createFixtureClient, type Assignment, type AssignmentClient } from "./client";

afterEach(cleanup);
const item = (overrides: Partial<Assignment> = {}): Assignment => ({ vacancy_title: "Analista contable", functions: [{ function: "responsible", started_at: "2026-11-02T18:00:00Z", ended_at: null }], started_at: "2026-11-02T18:00:00Z", ended_at: null, end_cause: null, effective_deadline: "2026-11-20", delivered_in_tramo: 8, placements: { direct: 1, participant: 0, shared: 0 }, ...overrides });
const clientFor = (items: Assignment[]): AssignmentClient => ({ getHistory: vi.fn().mockResolvedValue({ items, next_cursor: null }) });
it("shows current assignments first, all function badges and plain periods/end reasons without candidate data", async () => {
  const ended = "2026-11-12T18:00:00Z";
  const causes = ["reassigned", "left", "removed", "membership_ended"] as const;
  const client = clientFor([...causes.map((end_cause, i) => item({ vacancy_title: `Terminada ${i}`, ended_at: ended, end_cause, functions: [{ function: i % 2 ? "member" : "collaborator", started_at: "2026-11-02T18:00:00Z", ended_at: ended }] })), item()]);
  const { container } = render(<AssignmentHistory client={client} />);
  await screen.findByText("Analista contable");
  expect(screen.getAllByRole("listitem")[0]).toHaveTextContent("Analista contable");
  for (const label of ["Responsable", "Colaborador", "Miembro", "Desde el 2 nov 2026", ...["Te reasignaron", "Saliste de la vacante", "Te quitaron del equipo", "Dejaste la empresa"].map(reason => `Del 2 al 12 nov 2026 · ${reason}`)]) expect(screen.getAllByText(label).length).toBeGreaterThan(0);
  expect(screen.getAllByText("8 entregados")).toHaveLength(5);
  expect(screen.getAllByText("1 placement")).toHaveLength(5);
  expect(screen.getByRole("heading", { name: "AHORA" })).toHaveClass("uppercase");
  expect(screen.getByRole("heading", { name: "ANTES" })).toHaveClass("uppercase");
  expect(screen.queryByText("Primero las vacantes en las que trabajas ahora; después, tu trabajo anterior.")).not.toBeInTheDocument();
  const rows = screen.getAllByRole("listitem");
  for (const row of rows) {
    const content = row.querySelector('[data-slot="item-content"]')!;
    expect(content.children).toHaveLength(2);
    expect(content.children[0]).toContainElement(row.querySelector('[data-slot="item-title"]')!);
    expect(content.children[0]).toContainElement(row.querySelector('[data-slot="badge"]')!);
    expect(content.children[1]).toHaveAttribute("data-slot", "item-description");
    // Text wraps instead of being cut (browser review: narrow Sheet and mobile cut the end reason).
    expect(content.children[1]).toHaveClass("text-sm", "text-muted-foreground");
    expect(content.children[1].className).not.toMatch(/truncate|line-clamp-1/);
    expect(row.querySelector('[data-slot="item-media"] svg')).toHaveAttribute("aria-hidden", "true");
    expect(row.querySelector('[data-slot="item-media"]')).toHaveClass("rounded-full");
    expect(row.querySelector('[data-slot="item-actions"]')).toHaveClass("text-right", "tabular-nums");
    expect(row.querySelector('[data-slot="item-actions"]')!.children.length).toBeLessThanOrEqual(2);
  }
  expect(rows[0].querySelector('[data-slot="item-media"]')).toHaveClass("bg-status-success/10", "text-status-success");
  expect(rows[1].querySelector('[data-slot="item-media"]')).toHaveClass("bg-muted", "text-muted-foreground");
  expect(container.textContent).not.toMatch(/tramo|@|candidato.*nombre/i);
  expect(container.querySelectorAll('[data-slot="badge"]')).toHaveLength(5);
});
it("uses the last function and names previous functions in muted copy", async () => {
  render(<AssignmentHistory client={clientFor([item({ functions: [{ function: "collaborator", started_at: "2026-11-02T18:00:00Z", ended_at: "2026-11-04T18:00:00Z" }, { function: "responsible", started_at: "2026-11-04T18:00:00Z", ended_at: null }] })])} />);
  expect(await screen.findByText("Desde el 2 nov 2026 · antes Colaborador")).toHaveClass("text-muted-foreground", "text-sm");
  expect(screen.queryByText("Antes: Colaborador")).not.toBeInTheDocument();
  expect(screen.getByText("Responsable").closest('[data-slot="badge"]')).not.toBeNull();
});
it("agrees singular, plural and zero copy and keeps participant credits separate", async () => {
  render(<AssignmentHistory client={clientFor([item({ vacancy_title: "Una", delivered_in_tramo: 1, placements: { direct: 0, participant: 2, shared: 0 } }), item({ vacancy_title: "Varias", delivered_in_tramo: 2, placements: { direct: 1, participant: 1, shared: 1 } }), item({ vacancy_title: "Sin actividad", delivered_in_tramo: 0, placements: { direct: 0, participant: 0, shared: 0 } }), item({ vacancy_title: "Solo placement", delivered_in_tramo: 0, ended_at: "2026-11-12T18:00:00Z", end_cause: "left", placements: { direct: 0, participant: 0, shared: 1 } }), item({ vacancy_title: "Solo participación", delivered_in_tramo: 0, ended_at: "2026-11-12T18:00:00Z", end_cause: "left", placements: { direct: 0, participant: 1, shared: 0 } })])} />);
  expect(await screen.findByText("1 entregado")).toBeInTheDocument();
  expect(screen.getByText("2 entregados")).toBeInTheDocument();
  expect(screen.getByText("2 placements")).toBeInTheDocument();
  expect(screen.getByText("Sin entregas")).toHaveClass("text-muted-foreground");
  expect(screen.getByText("participaste en 2")).toBeInTheDocument();
  expect(screen.getAllByText("participaste en 1")).toHaveLength(2);
  expect(screen.getByText("1 placement")).toBeInTheDocument();
  for (const row of screen.getAllByRole("listitem")) {
    expect(row.textContent).not.toMatch(/\b0 (?:entregados|candidatos|placements)|participaste en 0|Entregaste 0/);
    expect(row.querySelector('[data-slot="item-actions"]')!.children.length).toBeLessThanOrEqual(2);
  }
  const summary = screen.getByRole("region", { name: "Resumen de tu trabajo" });
  expect(within(summary).getByText("Vacantes en las que trabajas ahora").parentElement).toHaveTextContent("3");
  expect(within(summary).getByText("Candidatos entregados").parentElement).toHaveTextContent("3");
  // direct + shared = 3, independently of the four participant credits.
  expect(within(summary).getByText("Placements").parentElement).toHaveTextContent("3");
});
it("caps the card at five and paginates only inside the Sheet without changing the summary", async () => {
  const client = createFixtureClient();
  const spy = vi.spyOn(client, "getHistory");
  render(<AssignmentHistory client={client} />);
  await screen.findByText("Analista contable");
  expect(screen.getAllByRole("listitem")).toHaveLength(5);
  const previewRows = screen.getAllByRole("listitem").map(row => row.textContent);
  const previewButton = screen.getByRole("button", { name: "Ver todo" });
  expect(previewButton).toHaveClass("border-border", "bg-background");
  expect(previewButton.closest('[data-slot="card-footer"]')).not.toBeNull();
  const summaryRegion = screen.getByRole("region", { name: "Resumen de tu trabajo" });
  expect(within(summaryRegion).getByText("Candidatos entregados").parentElement).toHaveTextContent("27");
  expect(within(summaryRegion).getByText("Placements").parentElement).toHaveTextContent("5");
  const summary = summaryRegion.textContent;
  fireEvent.click(screen.getByRole("button", { name: "Ver todo" }));
  const sheet = await screen.findByRole("dialog");
  expect(within(sheet).getAllByRole("listitem")).toHaveLength(10);
  expect(within(sheet).getAllByRole("listitem").slice(0, 5).map(row => row.textContent)).toEqual(previewRows);
  expect(within(sheet).getByRole("heading", { name: "AHORA" })).toBeInTheDocument();
  expect(within(sheet).getByRole("heading", { name: "ANTES" })).toBeInTheDocument();
  fireEvent.click(within(sheet).getByRole("button", { name: "Ver más" }));
  await waitFor(() => expect(within(sheet).getAllByRole("listitem")).toHaveLength(14));
  expect(spy).toHaveBeenCalledWith("10");
  expect(within(sheet).queryByRole("button", { name: "Ver más" })).not.toBeInTheDocument();
  expect(sheet.querySelector('[data-slot="sheet-header"]')).toBeInTheDocument();
  expect(sheet.querySelector('[data-slot="sheet-footer"]')).toBeInTheDocument();
  fireEvent.click(within(sheet).getByRole("button", { name: "Cerrar" }));
  expect(screen.getByRole("region", { name: "Resumen de tu trabajo" }).textContent).toBe(summary);
  expect(screen.getAllByRole("listitem")).toHaveLength(5);
});
it("shows the oriented empty state", async () => {
  render(<AssignmentHistory client={clientFor([])} />);
  expect(await screen.findByText("Todavía no has trabajado en vacantes")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Ver vacantes" })).toHaveAttribute("href", "/empresa/vacantes");
});
it("keeps read failures in StateCard and retries without writes", async () => {
  const getHistory = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue({ items: [], next_cursor: null });
  render(<AssignmentHistory client={{ getHistory }} />);
  fireEvent.click(await screen.findByRole("button", { name: "Reintentar" }));
  expect(await screen.findByText("Todavía no has trabajado en vacantes")).toBeInTheDocument();
  expect(getHistory).toHaveBeenCalledTimes(2);
});
it("loading preserves the summary and list primitive shape", async () => {
  let resolve!: (value: { items: Assignment[]; next_cursor: null }) => void;
  const promise = new Promise<{ items: Assignment[]; next_cursor: null }>(done => { resolve = done; });
  const { container } = render(<AssignmentHistory client={{ getHistory: () => promise }} />);
  expect(screen.getByRole("status")).toHaveTextContent("Cargando tu historial");
  const slots = () => [...container.querySelectorAll('[data-slot]')].map(node => node.getAttribute("data-slot")).filter(slot => slot !== "skeleton" && slot !== "badge");
  const before = slots();
  await act(async () => { resolve({ items: [item(), item({ vacancy_title: "Segunda" }), item({ vacancy_title: "Tercera" })], next_cursor: null }); });
  await screen.findByText("Analista contable");
  expect(slots()).toEqual(before);
});
