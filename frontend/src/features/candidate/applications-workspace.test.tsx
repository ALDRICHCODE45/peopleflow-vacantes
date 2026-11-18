import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
vi.mock("@/features/psychometrics/workspace/load", () => ({ loadWorkspaceAssessmentsAction: async () => ({ ok: true, data: { items: [] } }) }));
vi.mock("@/features/candidate-applications/actions", () => ({ loadApplicationsAction: vi.fn(), markMessageReadAction: vi.fn() }));
vi.mock("@/components/feedback/notify", () => ({ notifyActionResult: vi.fn() }));
import { loadApplicationsAction, markMessageReadAction } from "@/features/candidate-applications/actions";
import { page, id } from "@/features/candidate-applications/test-fixtures";
import { ApplicationsWorkspace } from "./applications-workspace";
beforeEach(() => { vi.resetAllMocks(); vi.mocked(markMessageReadAction).mockResolvedValue({ ok: true, data: null }); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const linkedId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const linked = { ...page.items[0], id: linkedId, status: "closed" as const, message: "Gracias por participar", message_read_at: null, updated_at: "2026-10-21T09:00:00Z", vacancy: { ...page.items[0].vacancy, title: "Diseño UX" } };
it.each([false, true])("opens a linked application and acknowledges only its unread revision (mobile=%s)", async mobile => {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: mobile && query.includes("max-width"), addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  vi.mocked(loadApplicationsAction).mockResolvedValue({ ok: true, data: { items: [page.items[0], linked], next_cursor: null } });
  render(<ApplicationsWorkspace initialApplicationId={linkedId} />);
  const detail = await screen.findByRole(mobile ? "dialog" : "complementary");
  expect(within(detail).getByRole("heading", { name: "Diseño UX" })).toBeVisible();
  expect(within(detail).getByText("Gracias por participar")).toBeVisible();
  await waitFor(() => expect(markMessageReadAction).toHaveBeenCalledExactlyOnceWith(linkedId, { updated_at: linked.updated_at }));
  if (mobile) await userEvent.setup().click(within(detail).getByRole("button", { name: "Volver a mis postulaciones" }));
  await userEvent.setup().click(screen.getByRole("link", { name: "Backend Go" }));
  expect(within(screen.getByRole(mobile ? "dialog" : "complementary")).getByRole("heading", { name: "Backend Go" })).toBeVisible();
  expect(markMessageReadAction).toHaveBeenCalledTimes(1);
});
it.each(["bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "not-an-id", "", undefined])("keeps the default selection for an unmatched id %s", async initialApplicationId => {
  vi.mocked(loadApplicationsAction).mockResolvedValue({ ok: true, data: { items: [page.items[0], linked], next_cursor: null } });
  render(<ApplicationsWorkspace initialApplicationId={initialApplicationId} />);
  const detail = await screen.findByRole("complementary");
  expect(within(detail).getByRole("heading", { name: "Backend Go" })).toBeVisible();
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(markMessageReadAction).not.toHaveBeenCalled();
});
it("acknowledges manual opening once, not when an unread row is merely listed", async () => {
  vi.mocked(loadApplicationsAction).mockResolvedValue({ ok: true, data: { items: [page.items[0], linked], next_cursor: null } });
  render(<ApplicationsWorkspace />);
  const row = await screen.findByRole("link", { name: "Diseño UX" });
  expect(markMessageReadAction).not.toHaveBeenCalled();
  await userEvent.setup().click(row);
  await waitFor(() => expect(markMessageReadAction).toHaveBeenCalledExactlyOnceWith(linkedId, { updated_at: linked.updated_at }));
  await userEvent.setup().click(screen.getByRole("link", { name: "Backend Go" }));
  await userEvent.setup().click(row);
  expect(markMessageReadAction).toHaveBeenCalledTimes(1);
});
it.each([
  { message_read_at: "2026-10-21T10:00:00Z", updated_at: linked.updated_at },
  { message_read_at: undefined, updated_at: linked.updated_at },
  { message_read_at: null, updated_at: undefined },
])("does not acknowledge an already read, unknown, or unversioned message %j", async state => {
  vi.mocked(loadApplicationsAction).mockResolvedValue({ ok: true, data: { items: [{ ...linked, ...state }], next_cursor: null } });
  render(<ApplicationsWorkspace initialApplicationId={linkedId} />);
  expect(await screen.findByText("Gracias por participar")).toBeVisible();
  expect(markMessageReadAction).not.toHaveBeenCalled();
});
it("leaves unread mobile rows untouched until their detail is opened", async () => {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("max-width"), addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  vi.mocked(loadApplicationsAction).mockResolvedValue({ ok: true, data: { items: [linked], next_cursor: null } });
  render(<ApplicationsWorkspace />);
  const row = await screen.findByRole("link", { name: "Diseño UX" });
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(markMessageReadAction).not.toHaveBeenCalled();
  await userEvent.setup().click(row);
  await screen.findByRole("dialog");
  await waitFor(() => expect(markMessageReadAction).toHaveBeenCalledExactlyOnceWith(linkedId, { updated_at: linked.updated_at }));
});
const valeria = [
  { ...page.items[0], id: "a4", status: "closed" as const, message: "Gracias por tu interés", message_read_at: null, updated_at: "2026-11-18T18:30:00Z", vacancy: { ...page.items[0].vacancy, title: "Desarrollador(a) Backend Go" } },
  { ...page.items[0], id: "a3", status: "in_process" as const, vacancy: { ...page.items[0].vacancy, title: "Ejecutivo(a) de Ventas Institucionales" } },
  { ...page.items[0], id: "a2", status: "in_process" as const, vacancy: { ...page.items[0].vacancy, title: "Químico(a) Farmacéutico(a) Responsable Sanitario" } },
  { ...page.items[0], id: "a1", vacancy: { ...page.items[0].vacancy, title: "Residente de Obra Civil" } },
];
const summary = () => screen.getByText((_, node) => node?.tagName === "P" && node.hasAttribute("data-pf-applications-summary"));
it("states the counts under the title: total, in process and closed", async () => {
  vi.mocked(loadApplicationsAction).mockResolvedValue({ ok: true, data: { items: valeria, next_cursor: null } });
  render(<ApplicationsWorkspace />);
  await screen.findByRole("link", { name: "Residente de Obra Civil" });
  expect(screen.getByRole("heading", { level: 2, name: "Mis postulaciones" })).toBeVisible();
  expect(summary()).toHaveTextContent(/^4 postulaciones · 2 en proceso · 1 cerrada$/);
  expect(screen.queryByText("Sigue tus procesos y encuentra lo que necesita tu atención.")).toBeNull();
});
it("uses singular and plural words in the counts line", async () => {
  vi.mocked(loadApplicationsAction).mockResolvedValue({ ok: true, data: page });
  render(<ApplicationsWorkspace />);
  await screen.findByRole("link", { name: "Backend Go" });
  expect(summary()).toHaveTextContent(/^1 postulación · 0 en proceso · 0 cerradas$/);
});
it("lists the applications in a «Tus postulaciones» section card with a count and a caption", async () => {
  vi.mocked(loadApplicationsAction).mockResolvedValue({ ok: true, data: { items: valeria, next_cursor: null } });
  render(<ApplicationsWorkspace />);
  const section = await screen.findByRole("region", { name: "Tus postulaciones 4" });
  expect(within(section).getByText("Solo ves el estado de tu postulación, no las etapas internas de la empresa.")).toBeVisible();
  expect(within(within(section).getByRole("list", { name: "Mis postulaciones" })).getAllByRole("listitem")).toHaveLength(4);
  await userEvent.setup().click(screen.getByRole("button", { name: "En proceso 2" }));
  expect(screen.getByRole("region", { name: "En proceso 2" })).toBeVisible();
});
it("marks the selected row with the tint and the left bar, never the outline ring", async () => {
  vi.mocked(loadApplicationsAction).mockResolvedValue({ ok: true, data: { items: valeria, next_cursor: null } });
  render(<ApplicationsWorkspace />);
  const first = await screen.findByRole("link", { name: "Desarrollador(a) Backend Go" });
  const other = screen.getByRole("link", { name: "Residente de Obra Civil" });
  expect(first).toHaveAttribute("aria-current", "true");
  expect(other).not.toHaveAttribute("aria-current");
  const row = (link: HTMLElement) => link.closest("[data-pf-application-row]")!;
  expect(row(first)).toHaveClass("bg-primary/7", "before:bg-primary", "before:w-[3px]");
  expect(row(first)).not.toHaveClass("ring-1", "ring-primary/40", "border");
  expect(row(other)).not.toHaveClass("bg-primary/7");
  await userEvent.setup().click(other);
  expect(other).toHaveAttribute("aria-current", "true");
  expect(row(other)).toHaveClass("bg-primary/7");
  expect(first).not.toHaveAttribute("aria-current");
  expect(row(first)).not.toHaveClass("bg-primary/7");
});
it("reads «Postulada hoy» for today and «hace N días» after", async () => {
  const today = new Date(Date.now() - 60_000).toISOString();
  const older = new Date(Date.now() - 3 * 86_400_000 - 60_000).toISOString();
  vi.mocked(loadApplicationsAction).mockResolvedValue({ ok: true, data: { items: [{ ...page.items[0], applied_at: today }, { ...valeria[3], applied_at: older }], next_cursor: null } });
  render(<ApplicationsWorkspace />);
  const list = await screen.findByRole("list", { name: "Mis postulaciones" });
  expect(within(list).getByText("Acme · Postulada hoy")).toBeVisible();
  expect(within(list).getByText("Acme · Postulada hace 3 días")).toBeVisible();
  expect(list).not.toHaveTextContent("hace 0 días");
});
it("flags a company message on its row: «Mensaje nuevo» until it is viewed, then «Mensaje de la empresa»", async () => {
  const unread = { ...valeria[0], id: "unread" };
  const read = { ...valeria[0], id: "read", message_read_at: "2026-11-18T19:00:00Z", vacancy: { ...valeria[0].vacancy, title: "Analista" } };
  vi.mocked(loadApplicationsAction).mockResolvedValue({ ok: true, data: { items: [valeria[3], unread, read], next_cursor: null } });
  render(<ApplicationsWorkspace />);
  const row = (name: string) => screen.getByRole("link", { name }).closest("[data-pf-application-row]") as HTMLElement;
  await screen.findByRole("link", { name: "Residente de Obra Civil" });
  expect(within(row("Desarrollador(a) Backend Go")).getByText("Mensaje nuevo")).toBeVisible();
  expect(within(row("Analista")).getByText("Mensaje de la empresa")).toBeVisible();
  expect(within(row("Residente de Obra Civil")).queryByText(/Mensaje/)).toBeNull();
  await userEvent.setup().click(screen.getByRole("link", { name: "Desarrollador(a) Backend Go" }));
  expect(within(row("Desarrollador(a) Backend Go")).queryByText("Mensaje nuevo")).toBeNull();
  expect(within(row("Desarrollador(a) Backend Go")).getByText("Mensaje de la empresa")).toBeVisible();
});
it("orders the light detail: logo, status, activity, message and «Ver vacante», without a dark surface", async () => {
  vi.mocked(loadApplicationsAction).mockResolvedValue({ ok: true, data: { items: valeria, next_cursor: null } });
  render(<ApplicationsWorkspace />);
  const detail = await screen.findByRole("complementary", { name: "Detalle de postulación" });
  expect(detail).not.toHaveClass("pf-kpi-hero", "bg-foreground");
  expect(detail.querySelector('[data-slot="avatar"]')).toHaveClass("size-16");
  expect(within(detail).getByRole("heading", { name: "Desarrollador(a) Backend Go" })).toBeVisible();
  expect(within(detail).getByText("Cerrada")).toHaveAttribute("data-variant", "neutral");
  expect(within(detail).getByRole("heading", { name: "Actividad del proceso" })).toBeVisible();
  expect(within(detail).getByText("Postulaste").parentElement?.querySelector("time")).toHaveAttribute("datetime", valeria[0].applied_at);
  expect(within(detail).getByRole("heading", { name: "Mensaje de la empresa" })).toBeVisible();
  expect(within(detail).getByText("Gracias por tu interés")).toBeVisible();
  expect(within(detail).getByRole("link", { name: "Ver vacante" })).toHaveAttribute("href", `/vacantes/${id}`);
  const row = screen.getByRole("link", { name: "Residente de Obra Civil" }).closest("[data-pf-application-row]")!;
  expect(row.querySelector('[data-slot="avatar"]')).toHaveClass("size-12");
  expect(row.querySelectorAll('[data-slot="badge"]')).toHaveLength(1);
  expect(within(row as HTMLElement).getByText("Enviada")).toHaveAttribute("data-variant", "info");
});
it("shows a structural skeleton during the real initial read", () => {
  vi.mocked(loadApplicationsAction).mockReturnValue(new Promise(() => {}));
  const { container } = render(<ApplicationsWorkspace />);
  expect(screen.getByText("Cargando postulaciones")).toBeInTheDocument();
  expect(screen.getByRole("heading", { level: 2, name: "Mis postulaciones" })).toBeVisible();
  expect(container.querySelectorAll("[data-pf-applications-loading-row]")).toHaveLength(4);
  expect(container.querySelector("[data-pf-applications-loading-summary]")).not.toBeNull();
  expect(screen.queryByText(/0 postulaciones/)).toBeNull();
});
it("invites a first application with links to vacancies and to saved vacancies", async () => {
  vi.mocked(loadApplicationsAction).mockResolvedValue({ ok: true, data: { items: [], next_cursor: null } });
  render(<ApplicationsWorkspace />);
  const card = await screen.findByRole("region", { name: "Todavía no te postulas a ninguna vacante" });
  expect(screen.getByText("Aún no te postulas a ninguna vacante.")).toBeVisible();
  expect(within(card).getByText("Tu seguimiento")).toBeVisible();
  expect(within(card).getByRole("link", { name: "Explorar vacantes" })).toHaveAttribute("href", "/vacantes");
  expect(within(card).getByRole("link", { name: "Ver vacantes guardadas" })).toHaveAttribute("href", "/candidato/guardadas");
  expect(screen.queryByRole("group", { name: "Filtrar postulaciones" })).toBeNull();
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
  const badge = within(screen.getByRole("list", { name: "Mis postulaciones" })).getByText("Enviada"); expect(badge).toHaveAttribute("data-variant", "info"); expect(badge).toHaveAttribute("data-dot");
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
  const detail = await screen.findByRole("complementary", { name: "Detalle de postulación" });
  expect(within(detail).getByText("Cerrada")).toBeVisible();
  expect(screen.getByText(/<b>Gracias<\/b>/)).toBeVisible();
  expect(container.querySelector("b")).toBeNull();
  expect(container).not.toHaveTextContent("Perfil no adecuado");
  expect(screen.getByText("El proceso de tu postulación finalizó.")).toBeVisible();
  expect(within(detail).getByRole("heading", { name: "Mensaje de la empresa" })).toBeVisible();
  expect(container.querySelector('[data-pf-application-message] p:last-child')).toHaveClass("whitespace-pre-wrap", "break-words");
});
it("keeps the facts and vacancy footer when closed without a message, without an empty message block", async () => {
  vi.mocked(loadApplicationsAction).mockResolvedValue({ ok: true, data: { ...page, items: [{ ...page.items[0], status: "closed", message: null }] } });
  const { container } = render(<ApplicationsWorkspace />);
  expect(within(await screen.findByRole("list", { name: "Mis postulaciones" })).getByText("Cerrada")).toHaveAttribute("data-variant", "neutral");
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
  expect(within(await screen.findByRole("list", { name: "Mis postulaciones" })).getByText("Vacante cerrada")).toHaveAttribute("data-variant", "neutral");
  expect(within(screen.getByRole("list", { name: "Mis postulaciones" })).queryByText("En proceso")).toBeNull();
  expect(screen.getByText("La empresa cerró esta vacante y finalizó el proceso.")).toBeVisible();
});
it("keeps «Cerrada» and its message for a discarded application of a closed vacancy", async () => {
  vi.mocked(loadApplicationsAction).mockResolvedValue({ ok: true, data: { ...page, items: [{ ...page.items[0], status: "closed", message: "Gracias", vacancy: { ...page.items[0].vacancy, state: "closed" } }] } });
  render(<ApplicationsWorkspace />);
  expect(within(await screen.findByRole("list", { name: "Mis postulaciones" })).getByText("Cerrada")).toBeVisible();
  expect(screen.queryByText("Vacante cerrada")).toBeNull();
  expect(screen.getByText("Gracias")).toBeVisible();
});
it("shows all four filters with their counts in a 2×2 grid below sm instead of a clipped scroller at 390 px", async () => {
  vi.mocked(loadApplicationsAction).mockResolvedValue({ ok: true, data: { items: [page.items[0], linked], next_cursor: null } });
  render(<ApplicationsWorkspace />);
  const group = await screen.findByRole("group", { name: "Filtrar postulaciones" });
  // Below sm the segmented track becomes a two-column grid; sm and up keep the original single row.
  expect(group).toHaveClass("max-sm:grid", "max-sm:w-full", "max-sm:grid-cols-2", "max-sm:h-auto!");
  // No horizontal scroller around it, so «Cerradas» can no longer sit off-screen.
  expect(group.parentElement).not.toHaveClass("overflow-x-auto");
  const filters = within(group).getAllByRole("button");
  expect(filters.map(filter => filter.textContent)).toEqual(["Todas2", "Por atender0", "En proceso0", "Cerradas1"]);
  for (const filter of filters) expect(filter).toHaveClass("max-sm:h-9!");
});
