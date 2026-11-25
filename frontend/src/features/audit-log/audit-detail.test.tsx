import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuditEventSheet } from "./audit-detail";
import type { AuditEvent } from "./model";
import { auditEvent, deletedVacancyId, luisId, vacancyId } from "./test-fixtures";

afterEach(cleanup);
const longAction = "Cambió el estado de una postulación";
const show = (event: AuditEvent | null, onClose = vi.fn()) => { render(<AuditEventSheet event={event} onClose={onClose} />); return { user: userEvent.setup(), onClose }; };
const row = (name: string) => screen.getByText(name, { selector: "dt" }).closest("div") as HTMLElement;

describe("event detail sheet", () => {
  it("renders nothing while no event is selected", () => {
    show(null);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("names the full action, the Mexico City moment and who did it", () => {
    show(auditEvent({ event_type: "ApplicationTransitioned", category: "candidate" }));
    const dialog = screen.getByRole("dialog", { name: longAction });
    expect(within(dialog).getByText(/hora de la Ciudad de México/)).toBeInTheDocument();
    expect(within(dialog).getByText(/11:03:12/)).toBeInTheDocument();
    expect(within(row("Quién")).getByText("Ana López")).toBeInTheDocument();
    expect(within(row("Quién")).getByText("ana@empresa.mx")).toBeInTheDocument();
    expect(within(row("Acción")).getByText(longAction)).toBeInTheDocument();
    expect(within(row("Acción")).getByText("Candidatos")).toBeInTheDocument();
  });

  it("shows the vacancy title in full and «Sobre» as the person or record the event is about", () => {
    const title = "Supervisor de Producción Turno Nocturno — Planta Apodaca (reemplazo temporal por incapacidad)";
    show(auditEvent({ vacancy: { id: vacancyId, title } }));
    expect(within(row("Vacante")).getByText(title).className).not.toMatch(/truncate|line-clamp/);
    expect(within(row("Sobre")).getByText("María Pérez")).toBeInTheDocument();
  });

  it("keeps the «Sobre» rule: «—» when the event is about the vacancy already shown", () => {
    show(auditEvent({ entity: { type: "job_draft", id: vacancyId, label: "Ejecutivo de ventas" } }));
    expect(row("Sobre")).toHaveTextContent("—");
    expect(within(row("Sobre")).queryByText("Ejecutivo de ventas")).toBeNull();
    expect(within(row("Vacante")).getByText("Ejecutivo de ventas")).toBeInTheDocument();
  });

  it("tells a former member, a deleted user, the system, a deleted vacancy and an event with no vacancy apart", () => {
    show(auditEvent({ actor: { type: "user", user_id: luisId, name: "Luis Soto", email: "luis@empresa.mx", is_current_member: false }, vacancy: { id: deletedVacancyId, title: null } }));
    expect(within(row("Quién")).getByText("Ex miembro")).toBeInTheDocument();
    expect(within(row("Vacante")).getByText("Vacante eliminada")).toBeInTheDocument();
    cleanup();
    show(auditEvent({ actor: { type: "system" }, vacancy: null, ip: null, ip_source: null, user_agent: null }));
    expect(within(row("Quién")).getByText("Sistema")).toBeInTheDocument();
    expect(within(row("Vacante")).getByText("Este evento no es de una vacante.")).toBeInTheDocument();
    expect(row("IP")).toHaveTextContent("—");
    expect(row("Navegador")).toHaveTextContent("—");
  });

  it("shows the IP with its warning when it is unverified, the browser and the full user agent", () => {
    const event = auditEvent({ ip_source: "peer", ip: "10.0.0.5" });
    show(event);
    expect(within(row("IP")).getByText("10.0.0.5")).toHaveClass("font-mono");
    expect(within(row("IP")).getByText("IP no verificada")).toBeInTheDocument();
    expect(within(row("Navegador")).getByText("Safari · macOS")).toBeInTheDocument();
    expect(within(row("Navegador")).getByText(event.user_agent!)).toHaveClass("font-mono");
  });

  it("lists the metadata as key and value, or says there is none, and shows the event id", () => {
    const event = auditEvent();
    show(event);
    const metadata = row("Metadatos");
    expect(within(metadata).getByText("kind")).toBeInTheDocument();
    expect(within(metadata).getByText("organic")).toBeInTheDocument();
    expect(within(row("ID del evento")).getByText(event.id)).toBeInTheDocument();
    cleanup();
    show(auditEvent({ metadata: {} }));
    expect(within(row("Metadatos")).getByText("Este evento no guarda metadatos.")).toBeInTheDocument();
  });

  it.each([false, true])("scrolls in a focusable, named region instead of a bare list (axe scrollable-region-focusable), phone=%s", phone => {
    render(<AuditEventSheet event={auditEvent()} onClose={vi.fn()} phone={phone} />);
    const dialog = screen.getByRole("dialog");
    const region = within(dialog).getByRole("region", { name: "Detalle del evento" });
    expect(region).toHaveAttribute("tabindex", "0");
    expect(region).toHaveClass("overflow-y-auto", "min-h-0", "flex-1");
    const list = region.querySelector("dl") as HTMLElement;
    expect(list).not.toBeNull();
    expect(list.className).not.toMatch(/overflow/);
  });

  it("closes with «Cerrar»", async () => {
    const { user, onClose } = show(auditEvent());
    await user.click(screen.getAllByRole("button", { name: "Cerrar" })[0]);
    expect(onClose).toHaveBeenCalled();
  });

  it("copies the event id and confirms it", async () => {
    const event = auditEvent();
    const { user } = show(event); // user-event installs its own clipboard
    await user.click(screen.getByRole("button", { name: "Copiar ID" }));
    expect(await screen.findByText("ID copiado")).toBeInTheDocument();
    expect(await navigator.clipboard.readText()).toBe(event.id);
  });
});
