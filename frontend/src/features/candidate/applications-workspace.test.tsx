import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
vi.mock("@/features/candidate-applications/actions", () => ({ loadApplicationsAction: vi.fn() }));
vi.mock("@/components/feedback/notify", () => ({ notifyActionResult: vi.fn() }));
import { loadApplicationsAction } from "@/features/candidate-applications/actions";
import { page, id } from "@/features/candidate-applications/test-fixtures";
import { ApplicationsWorkspace } from "./applications-workspace";
beforeEach(() => { vi.resetAllMocks(); });
afterEach(cleanup);
it("shows a structural skeleton during the real initial read", () => {
  vi.mocked(loadApplicationsAction).mockReturnValue(new Promise(() => {}));
  const { container } = render(<ApplicationsWorkspace />);
  expect(screen.getByText("Cargando postulaciones")).toBeInTheDocument(); expect(container.querySelector('[data-slot="skeleton"]')).not.toBeNull();
});
it("shows the empty state with a vacancy link", async () => {
  vi.mocked(loadApplicationsAction).mockResolvedValue({ ok: true, data: { items: [], next_cursor: null } }); render(<ApplicationsWorkspace />);
  expect(await screen.findByText("Todavía no te postulaste a ninguna vacante")).toBeVisible(); expect(screen.getByRole("link", { name: "Explorar vacantes" })).toHaveAttribute("href", "/vacantes");
});
it("retains an error and retries only explicitly", async () => {
  vi.mocked(loadApplicationsAction).mockResolvedValueOnce({ ok: false, reason: "no_response", reference: {} }).mockResolvedValueOnce({ ok: true, data: page }); render(<ApplicationsWorkspace />);
  await userEvent.setup().click(await screen.findByRole("button", { name: "Reintentar" })); expect(await screen.findByRole("link", { name: "Backend Go" })).toHaveAttribute("href", `/vacantes/${id}`); expect(loadApplicationsAction).toHaveBeenCalledTimes(2);
});
it("shows only contract facts and status, then appends the next page", async () => {
  vi.mocked(loadApplicationsAction).mockResolvedValueOnce({ ok: true, data: { ...page, next_cursor: "opaque" } }).mockResolvedValueOnce({ ok: true, data: { items: [{ ...page.items[0], id, vacancy: { id, title: "Frontend" } }], next_cursor: null } });
  const { container } = render(<ApplicationsWorkspace />); expect(await screen.findByText("Acme")).toBeVisible(); expect(screen.getByText("16 de octubre de 2026")).toBeVisible();
  const badge = screen.getByText("Enviada"); expect(badge).toHaveAttribute("data-variant", "info"); expect(badge).toHaveAttribute("data-dot");
  await userEvent.setup().click(screen.getByRole("button", { name: "Cargar más" })); expect(loadApplicationsAction).toHaveBeenLastCalledWith({ cursor: "opaque" }); expect(await screen.findByRole("link", { name: "Frontend" })).toBeVisible(); expect(screen.getByRole("link", { name: "Backend Go" })).toBeVisible();
  expect(container).not.toHaveTextContent(/En revisión|Contratada|Rechazada|Carta de presentación|Fuente/); expect(screen.queryByRole("button", { name: "Cargar más" })).toBeNull();
});
it("shows En proceso for moved applications without revealing their internal stage", async () => {
  vi.mocked(loadApplicationsAction).mockResolvedValue({ ok: true, data: { ...page, items: [{ ...page.items[0], status: "in_process" }] } });
  render(<ApplicationsWorkspace />);
  expect(await screen.findByText("En proceso")).toHaveAttribute("data-variant", "review");
  expect(screen.queryByText("Enviada")).not.toBeInTheDocument();
  expect(screen.queryByText("Postulación enviada")).not.toBeInTheDocument();
});
it("shows Finalizada and the candidate message as plain text, not internal reasons", async () => {
  vi.mocked(loadApplicationsAction).mockResolvedValue({ ok: true, data: { ...page, items: [{ ...page.items[0], status: "closed", message: "<b>Gracias</b>\nSigue buscando" }] } });
  const { container } = render(<ApplicationsWorkspace />);
  expect(await screen.findByText("Finalizada")).toBeVisible();
  expect(screen.getByText(/<b>Gracias<\/b>/)).toBeVisible();
  expect(container.querySelector("b")).toBeNull();
  expect(container).not.toHaveTextContent("Perfil no adecuado");
});
it("preserves loaded rows and the same cursor when loading more fails", async () => {
  vi.mocked(loadApplicationsAction).mockResolvedValueOnce({ ok: true, data: { ...page, next_cursor: "opaque" } }).mockResolvedValueOnce({ ok: false, reason: "server_error", reference: {} }).mockResolvedValueOnce({ ok: true, data: { items: [], next_cursor: null } });
  render(<ApplicationsWorkspace />); await userEvent.setup().click(await screen.findByRole("button", { name: "Cargar más" })); expect(await screen.findByRole("button", { name: "Reintentar" })).toBeVisible(); expect(screen.getByRole("link", { name: "Backend Go" })).toBeVisible(); await userEvent.setup().click(screen.getByRole("button", { name: "Reintentar" })); expect(loadApplicationsAction).toHaveBeenLastCalledWith({ cursor: "opaque" });
});
