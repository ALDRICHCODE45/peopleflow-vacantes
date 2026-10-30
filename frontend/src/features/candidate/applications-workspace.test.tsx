import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
vi.mock("@/features/psychometrics/workspace/load", () => ({ loadWorkspaceAssessmentsAction: async () => ({ ok: true, data: { items: [] } }) }));
vi.mock("@/features/candidate-applications/actions", () => ({ loadApplicationsAction: vi.fn() }));
vi.mock("@/components/feedback/notify", () => ({ notifyActionResult: vi.fn() }));
import { loadApplicationsAction } from "@/features/candidate-applications/actions";
import { page, id } from "@/features/candidate-applications/test-fixtures";
import { ApplicationsWorkspace } from "./applications-workspace";
beforeEach(() => { vi.resetAllMocks(); });
afterEach(cleanup);
it("orders compact identity, status and dated detail without duplicating vacancy actions", async () => {
  vi.mocked(loadApplicationsAction).mockResolvedValue({ ok: true, data: page });
  render(<ApplicationsWorkspace />);
  const title = await screen.findByRole("link", { name: "Backend Go" });
  const row = title.closest('[data-pf-application-row]')!;
  expect(row.querySelector("h3")).toContainElement(title);
  expect(row).toHaveTextContent("Acme");
  expect(row.querySelector('[data-slot="badge"]')).toHaveTextContent("Enviada");
  expect(row.querySelector('[data-slot="avatar"]')).not.toBeNull();
  expect(title).not.toHaveClass("hover:underline");
  const detail = screen.getByRole("complementary", { name: "Detalle de postulación" });
  expect(within(detail).getByText("Postulaste")).toBeVisible();
  // Open applications carry no filler line: the status chip already states it.
  expect(within(detail).queryByText("Tu postulación fue enviada.")).toBeNull();
  expect(detail.querySelector("time")).toHaveAttribute("datetime", page.items[0].applied_at);
  expect(detail.querySelectorAll("time")).toHaveLength(1);
  const footer = detail.querySelector('[data-slot="card-footer"]')!;
  expect(footer.querySelector("time")).toBeNull();
  expect(row.querySelectorAll('[data-slot="badge"]')).toHaveLength(1);
  const link = within(footer as HTMLElement).getByRole("link", { name: "Ver vacante" });
  expect(link).toHaveAttribute("href", `/vacantes/${id}`);
  expect(link).toHaveClass("border-border");
  expect(link).not.toHaveClass("border-transparent");
  expect(detail.querySelector('[data-slot="card-header"]')).toHaveClass("border-b");
  expect(footer).toHaveClass("border-t");
});
it("shows a structural skeleton during the real initial read", () => {
  vi.mocked(loadApplicationsAction).mockReturnValue(new Promise(() => {}));
  const { container } = render(<ApplicationsWorkspace />);
  expect(screen.getByText("Cargando postulaciones")).toBeInTheDocument();
  expect(container.querySelector('[data-slot="skeleton"]')).not.toBeNull();
  const placeholders = container.querySelectorAll('[data-slot="card"]');
  expect(placeholders).toHaveLength(3);
  for (const card of placeholders) {
    expect(card).toHaveAttribute("data-size", "sm");
    expect(card.querySelector('[data-slot="card-content"]')).not.toBeNull();
    expect(card).toHaveAttribute("aria-hidden", "true");
  }
  expect(container.querySelector('[data-pf-applications-loading-search]')).not.toBeNull();
});
it("mirrors the loaded inbox slots and responsive row layout in the initial skeleton", async () => {
  vi.mocked(loadApplicationsAction).mockReturnValue(new Promise(() => {}));
  const loading = render(<ApplicationsWorkspace />);
  const skeleton = loading.container.querySelector('[data-slot="card"]')!;
  const sequence = (card: Element) => [...card.querySelectorAll('[data-slot^="card-"]')].map(node => node.getAttribute("data-slot"));
  const expected = sequence(skeleton);
  const grid = skeleton.closest("ul")!.className;
  const layout = skeleton.querySelector('[data-slot="card-content"] > div')!.className;
  loading.unmount();
  vi.mocked(loadApplicationsAction).mockResolvedValue({ ok: true, data: page });
  const loaded = render(<ApplicationsWorkspace />);
  await screen.findByRole("link", { name: "Backend Go" });
  const card = loaded.container.querySelector('[data-pf-application-row]')!;
  expect(sequence(card)).toEqual(expected);
  expect(card.closest("ul")).toHaveAttribute("class", grid);
  expect(card.querySelector('[data-slot="card-content"] > div')).toHaveAttribute("class", layout);
});
it("makes the empty state's next step prominent, readable and mobile-width", async () => {
  vi.mocked(loadApplicationsAction).mockResolvedValue({ ok: true, data: { items: [], next_cursor: null } });
  render(<ApplicationsWorkspace />);
  const title = await screen.findByText("Todavía no te postulaste a ninguna vacante");
  expect(title).toHaveClass("text-xl", "font-semibold");
  expect(title.closest('[data-slot="card"]')?.querySelector('[data-slot="empty-icon"]')).not.toBeNull();
  expect(title.closest('[data-slot="empty-header"]')).toHaveClass("max-w-md");
  expect(screen.getByRole("link", { name: "Explorar vacantes" })).toHaveClass("bg-primary", "w-full", "sm:w-auto");
  expect(screen.getByText("Tus postulaciones aparecerán aquí cuando envíes una. Mientras tanto, explora las vacantes disponibles.")).toBeVisible();
});
it("shows the empty state with a vacancy link", async () => {
  vi.mocked(loadApplicationsAction).mockResolvedValue({ ok: true, data: { items: [], next_cursor: null } }); render(<ApplicationsWorkspace />);
  expect(await screen.findByText("Todavía no te postulaste a ninguna vacante")).toBeVisible(); expect(screen.getByRole("link", { name: "Explorar vacantes" })).toHaveAttribute("href", "/vacantes");
});
it("shows initial failures in a recovery card", async () => {
  vi.mocked(loadApplicationsAction).mockResolvedValue({ ok: false, reason: "no_response", reference: {} });
  render(<ApplicationsWorkspace />);
  const title = await screen.findByRole("heading", { name: "No pudimos cargar las postulaciones" });
  expect(title.closest('[data-slot="card"]')).not.toBeNull();
  expect(screen.getByRole("link", { name: "Ir al panel" })).toHaveAttribute("href", "/candidato");
  expect(loadApplicationsAction).toHaveBeenCalledTimes(1);
});
it("retains an error and retries only explicitly", async () => {
  vi.mocked(loadApplicationsAction).mockResolvedValueOnce({ ok: false, reason: "no_response", reference: {} }).mockResolvedValueOnce({ ok: true, data: page }); render(<ApplicationsWorkspace />);
  await userEvent.setup().click(await screen.findByRole("button", { name: "Reintentar" })); expect(await screen.findByRole("link", { name: "Backend Go" })).toHaveAttribute("href", `/vacantes/${id}`); expect(loadApplicationsAction).toHaveBeenCalledTimes(2);
});
it("shows only contract facts and status, then appends the next page", async () => {
  vi.mocked(loadApplicationsAction).mockResolvedValueOnce({ ok: true, data: { ...page, next_cursor: "opaque" } }).mockResolvedValueOnce({ ok: true, data: { items: [{ ...page.items[0], id, vacancy: { id, title: "Frontend", state: "open" as const } }], next_cursor: null } });
  const { container } = render(<ApplicationsWorkspace />); expect((await screen.findAllByText("Acme"))[0]).toBeVisible(); expect(screen.getByText("16 de octubre de 2026")).toBeVisible();
  const badge = screen.getByText("Enviada"); expect(badge).toHaveAttribute("data-variant", "info"); expect(badge).toHaveAttribute("data-dot");
  await userEvent.setup().click(screen.getByRole("button", { name: "Cargar más" })); expect(loadApplicationsAction).toHaveBeenLastCalledWith({ cursor: "opaque" }); expect(await screen.findByRole("link", { name: "Frontend" })).toBeVisible(); expect(screen.getByRole("link", { name: "Backend Go" })).toBeVisible();
  expect(container).not.toHaveTextContent(/En revisión|Contratada|Rechazada|Carta de presentación|Fuente/); expect(screen.queryByRole("button", { name: "Cargar más" })).toBeNull();
});
it("shows En proceso for moved applications without revealing their internal stage", async () => {
  vi.mocked(loadApplicationsAction).mockResolvedValue({ ok: true, data: { ...page, items: [{ ...page.items[0], status: "in_process" }] } });
  render(<ApplicationsWorkspace />);
  await screen.findByRole("link", { name: "Backend Go" });
  expect(within(screen.getByRole("list", { name: "Mis postulaciones" })).getByText("En proceso")).toHaveAttribute("data-variant", "review");
  expect(screen.queryByText("Enviada")).not.toBeInTheDocument();
  expect(screen.queryByText("Postulación enviada")).not.toBeInTheDocument();
  expect(screen.queryByText("Tu postulación avanzó en el proceso.")).toBeNull();
  expect(screen.queryByText("Mensaje de la empresa")).toBeNull();
});
it("shows Cerrada and the candidate message as plain text, not internal reasons", async () => {
  vi.mocked(loadApplicationsAction).mockResolvedValue({ ok: true, data: { ...page, items: [{ ...page.items[0], status: "closed", message: "<b>Gracias</b>\nSigue buscando" }] } });
  const { container } = render(<ApplicationsWorkspace />);
  expect(await screen.findByText("Cerrada")).toBeVisible();
  expect(screen.getByText(/<b>Gracias<\/b>/)).toBeVisible();
  expect(container.querySelector("b")).toBeNull();
  expect(container).not.toHaveTextContent("Perfil no adecuado");
  expect(screen.getByText("El proceso de tu postulación finalizó.")).toBeVisible();
  expect(screen.getByText("Mensaje de la empresa")).toBeVisible();
  expect(container.querySelector('[data-pf-application-message] p:last-child')).toHaveClass("whitespace-pre-wrap", "text-muted-foreground");
});
it("keeps the facts and vacancy footer when closed without a message, without an empty message block", async () => {
  vi.mocked(loadApplicationsAction).mockResolvedValue({ ok: true, data: { ...page, items: [{ ...page.items[0], status: "closed", message: null }] } });
  const { container } = render(<ApplicationsWorkspace />);
  expect(await screen.findByText("Cerrada")).toHaveAttribute("data-variant", "neutral");
  expect(screen.getByRole("link", { name: "Ver vacante" })).toHaveAttribute("href", `/vacantes/${id}`);
  expect(screen.getByText("Postulaste")).toBeVisible();
  expect(screen.getByText("El proceso de tu postulación finalizó.")).toBeVisible();
  expect(container.querySelector('[data-pf-application-message]')).toBeNull();
  expect(container).not.toHaveTextContent(/Actualizada|Contratada|Fuente|Carta de presentación/);
});
it("preserves loaded rows and the same cursor when loading more fails", async () => {
  vi.mocked(loadApplicationsAction).mockResolvedValueOnce({ ok: true, data: { ...page, next_cursor: "opaque" } }).mockResolvedValueOnce({ ok: false, reason: "server_error", reference: {} }).mockResolvedValueOnce({ ok: true, data: { items: [], next_cursor: null } });
  render(<ApplicationsWorkspace />); await userEvent.setup().click(await screen.findByRole("button", { name: "Cargar más" })); expect(await screen.findByRole("button", { name: "Reintentar" })).toBeVisible(); expect(screen.getByRole("link", { name: "Backend Go" })).toBeVisible(); await userEvent.setup().click(screen.getByRole("button", { name: "Reintentar" })); expect(loadApplicationsAction).toHaveBeenLastCalledWith({ cursor: "opaque" });
});
it("shows «Vacante cerrada» when the company finished the process of an active application", async () => {
  vi.mocked(loadApplicationsAction).mockResolvedValue({ ok: true, data: { ...page, items: [{ ...page.items[0], status: "in_process", vacancy: { ...page.items[0].vacancy, state: "closed" } }] } });
  render(<ApplicationsWorkspace />);
  expect(await screen.findByText("Vacante cerrada")).toHaveAttribute("data-variant", "neutral");
  expect(within(screen.getByRole("list", { name: "Mis postulaciones" })).queryByText("En proceso")).toBeNull();
  expect(screen.getByText("La empresa cerró esta vacante y finalizó el proceso.")).toBeVisible();
});
it("keeps «Cerrada» and its message for a discarded application of a closed vacancy", async () => {
  vi.mocked(loadApplicationsAction).mockResolvedValue({ ok: true, data: { ...page, items: [{ ...page.items[0], status: "closed", message: "Gracias", vacancy: { ...page.items[0].vacancy, state: "closed" } }] } });
  render(<ApplicationsWorkspace />);
  expect(await screen.findByText("Cerrada")).toBeVisible();
  expect(screen.queryByText("Vacante cerrada")).toBeNull();
  expect(screen.getByText("Gracias")).toBeVisible();
});
