import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../actions", () => ({
  getPreferencesAction: vi.fn(), updatePreferencesAction: vi.fn(),
  getCandidatePreferencesAction: vi.fn(), updateCandidatePreferencesAction: vi.fn(),
}));
import * as actions from "../actions";
import type { NotificationPreferences as Catalog, PreferencesResult } from "../model";
import { candidatePreferences, memberPreferences, preferenceItem } from "../test-fixtures";
import { stubBrowserApis } from "./inbox-harness";
import { NotificationPreferences } from "./notification-preferences";

const m = vi.mocked(actions);
const ok = (data: Catalog): PreferencesResult => ({ ok: true, data });
const sw = (name: string) => screen.getByRole("switch", { name });

beforeEach(() => {
  vi.resetAllMocks();
  stubBrowserApis();
  m.getPreferencesAction.mockResolvedValue(ok(memberPreferences()));
  m.getCandidatePreferencesAction.mockResolvedValue(ok(candidatePreferences()));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

async function renderCompany() {
  const user = userEvent.setup();
  render(<NotificationPreferences scope="company" />);
  await screen.findByRole("heading", { level: 3, name: "Postulaciones" });
  return user;
}

describe("company catalog (design 05)", () => {
  it("shows a skeleton with a status while the catalog loads", () => {
    m.getPreferencesAction.mockReturnValue(new Promise(() => {}));
    render(<NotificationPreferences scope="company" />);
    expect(screen.getByRole("status")).toHaveTextContent("Cargando preferencias");
  });

  it("groups the member types like the inbox filter, each with «En la app» and «Correo» switches", async () => {
    await renderCompany();
    expect(screen.getAllByRole("heading", { level: 3 }).map(h => h.textContent)).toEqual(["Postulaciones", "Entregas", "Vacantes y equipo", "Pruebas"]);
    expect(screen.getAllByRole("switch")).toHaveLength(22);
    expect(sw("Nueva postulación En la app")).toHaveAttribute("aria-checked", "true");
    expect(sw("Nueva postulación Correo")).toHaveAttribute("aria-checked", "false");
    expect(sw("Nueva postulación Correo")).toBeEnabled();
    const tests = screen.getByRole("region", { name: "Pruebas" });
    expect(within(tests).getAllByRole("listitem")).toHaveLength(2);
    expect(m.getCandidatePreferencesAction).not.toHaveBeenCalled();
  });

  it("locks mandatory pairs: on, disabled, marked «Obligatoria», and a click changes nothing", async () => {
    const user = await renderCompany();
    const overdue = screen.getByText("Entrega vencida").closest("li")!;
    expect(within(overdue).getByText("Obligatoria")).toBeInTheDocument();
    for (const name of ["Entrega vencida En la app", "Entrega vencida Correo"]) {
      expect(sw(name)).toHaveAttribute("aria-checked", "true");
      expect(sw(name)).toBeDisabled();
    }
    await user.click(sw("Entrega vencida Correo"));
    expect(sw("Entrega vencida Correo")).toHaveAttribute("aria-checked", "true");
    expect(screen.queryByText(/sin guardar/)).toBeNull();
  });

  it("collects toggles in the save bar and sends only the changed unlocked pairs, then renders the PUT answer", async () => {
    const answer = memberPreferences({ items: memberPreferences().items.map(item =>
      item.type === "application_received" ? preferenceItem(item.type, item.kind, false, { email: true })
        : item.type === "psychometric_completed" ? preferenceItem(item.type, item.kind, false, { email: true }) : item) });
    m.updatePreferencesAction.mockResolvedValue(ok(answer));
    const user = await renderCompany();
    await user.click(sw("Nueva postulación Correo"));
    await user.click(sw("Prueba pendiente del candidato En la app"));
    expect(screen.getByText("2 cambios sin guardar")).toBeInTheDocument();
    await user.click(sw("Prueba pendiente del candidato En la app"));
    expect(screen.getByText("1 cambio sin guardar")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));
    expect(m.updatePreferencesAction).toHaveBeenCalledWith([{ type: "application_received", channel: "email", enabled: true }], memberPreferences());
    expect(await screen.findByText("Preferencias guardadas")).toBeInTheDocument();
    // Rendered from the response, including a value this page did not send.
    expect(sw("Prueba completada Correo")).toHaveAttribute("aria-checked", "true");
    expect(screen.queryByRole("button", { name: "Guardar cambios" })).toBeNull();
  });

  it("«Descartar» returns every switch to the saved catalog without a request", async () => {
    const user = await renderCompany();
    await user.click(sw("Nueva postulación Correo"));
    await user.click(screen.getByRole("button", { name: "Descartar" }));
    expect(sw("Nueva postulación Correo")).toHaveAttribute("aria-checked", "false");
    expect(screen.queryByText(/sin guardar/)).toBeNull();
    expect(m.updatePreferencesAction).not.toHaveBeenCalled();
  });

  it("a failed save says so, keeps the unsaved choice to retry, and «Descartar» rolls back to the saved catalog", async () => {
    m.updatePreferencesAction.mockResolvedValueOnce({ ok: false, reason: "server_error", reference: { status: 500 } });
    const user = await renderCompany();
    await user.click(sw("Nueva postulación Correo"));
    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("No pudimos guardar tus preferencias. Inténtalo de nuevo.");
    expect(sw("Nueva postulación Correo")).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText("1 cambio sin guardar")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Descartar" }));
    expect(sw("Nueva postulación Correo")).toHaveAttribute("aria-checked", "false");
  });

  it("a 422 lock re-reads the catalog and explains the mandatory notices", async () => {
    const relocked = memberPreferences({ items: memberPreferences().items.map(item => item.type === "application_received" ? preferenceItem(item.type, "mandatory") : item) });
    m.updatePreferencesAction.mockResolvedValue({ ok: false, reason: "preference_locked", lockedTypes: ["application_received"], reference: { status: 422 } });
    m.getPreferencesAction.mockResolvedValueOnce(ok(memberPreferences())).mockResolvedValueOnce(ok(relocked));
    const user = await renderCompany();
    await user.click(sw("Nueva postulación Correo"));
    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Algunos avisos son obligatorios y no se pueden apagar. Actualizamos la lista.");
    await waitFor(() => expect(sw("Nueva postulación Correo")).toBeDisabled());
    expect(m.getPreferencesAction).toHaveBeenCalledTimes(2);
  });

  it("warns when a notice is turned off everywhere", async () => {
    const user = await renderCompany();
    await user.click(sw("Prueba completada En la app"));
    const row = screen.getByText("Prueba completada").closest("li")!;
    expect(within(row).getByText("Con esto no te llegará este aviso por ningún medio.")).toBeInTheDocument();
  });

  it("marks a personal choice as «Tu ajuste» and «Restablecer recomendados» brings back the defaults of unlocked pairs", async () => {
    m.getPreferencesAction.mockResolvedValue(ok(memberPreferences({ items: memberPreferences().items.map(item =>
      item.type === "application_received" ? preferenceItem(item.type, item.kind, false, { email: true }) : item) })));
    const user = await renderCompany();
    const row = screen.getByText("Nueva postulación").closest("li")!;
    expect(within(row).getByText("Tu ajuste · recomendado: correo apagado")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Restablecer recomendados" }));
    expect(sw("Nueva postulación Correo")).toHaveAttribute("aria-checked", "false");
    expect(screen.getByText("1 cambio sin guardar")).toBeInTheDocument();
  });

  it("tells the person when emails cannot be delivered to the account, without showing an address", async () => {
    m.getPreferencesAction.mockResolvedValue(ok(memberPreferences({ email_deliverable: false })));
    await renderCompany();
    expect(screen.getByText("No podemos entregar correos a tu cuenta. Los avisos siguen llegando a la app.")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/@/);
  });

  it("keeps an unknown future type, labelled generically under «Otros avisos», and still switchable", async () => {
    m.getPreferencesAction.mockResolvedValue(ok(memberPreferences({ items: [...memberPreferences().items, preferenceItem("something_new", "operational")] })));
    const user = await renderCompany();
    const others = screen.getByRole("region", { name: "Otros avisos" });
    expect(within(others).getByText("Otro aviso")).toBeInTheDocument();
    await user.click(within(others).getByRole("switch", { name: "Otro aviso Correo" }));
    expect(screen.getByText("1 cambio sin guardar")).toBeInTheDocument();
  });

  it("offers «Reintentar» when the catalog cannot be read", async () => {
    m.getPreferencesAction.mockResolvedValueOnce({ ok: false, reason: "no_response", reference: {} });
    const user = userEvent.setup();
    render(<NotificationPreferences scope="company" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("No pudimos cargar tus preferencias.");
    await user.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByRole("heading", { level: 3, name: "Postulaciones" })).toBeInTheDocument();
  });
});

describe("candidate catalog", () => {
  it("lists the three candidate types, all switchable, on the candidate actions only", async () => {
    m.updateCandidatePreferencesAction.mockResolvedValue(ok(candidatePreferences()));
    const user = userEvent.setup();
    render(<NotificationPreferences scope="candidate" />);
    expect(await screen.findByRole("heading", { level: 3, name: "Tus postulaciones" })).toBeInTheDocument();
    expect(screen.getAllByRole("switch")).toHaveLength(6);
    for (const control of screen.getAllByRole("switch")) expect(control).toBeEnabled();
    expect(sw("Mensajes de las empresas Correo")).toHaveAttribute("aria-checked", "true");
    await user.click(sw("Mensajes de las empresas Correo"));
    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));
    expect(m.updateCandidatePreferencesAction).toHaveBeenCalledWith([{ type: "candidate_message_received", channel: "email", enabled: false }], candidatePreferences());
    expect(m.getPreferencesAction).not.toHaveBeenCalled();
    expect(m.updatePreferencesAction).not.toHaveBeenCalled();
  });
});
