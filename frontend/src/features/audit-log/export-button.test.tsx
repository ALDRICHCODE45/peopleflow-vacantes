import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/components/ui/popover", async () => (await import("./test-popover")).popoverModule());
import { ExportAuditButton } from "./export-button";
import type { AuditOptions } from "./model";
import { anaId, auditActors, auditTypes, auditVacancies } from "./test-fixtures";
import type { AuditFilters } from "./url-state";

const options: AuditOptions = { types: auditTypes, actors: auditActors, vacancies: auditVacancies };
const fetchMock = vi.fn();
let created: Blob[];
let downloads: string[];
const csv = () => new Response("﻿occurred_at\r\n", { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="auditoria-2026-11-04.csv"' } });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
const setup = (filters: AuditFilters = {}) => { render(<ExportAuditButton filters={filters} options={options} />); return userEvent.setup(); };
const trigger = () => screen.getByRole("button", { name: "Exportar CSV" });
const openPanel = async (user: ReturnType<typeof userEvent.setup>) => { await user.click(trigger()); return screen.findByRole("dialog", { name: "Exportar a CSV" }); };
const download = (panel: HTMLElement) => within(panel).getByRole("button", { name: /Descargar CSV|Descargando/ });

beforeEach(() => {
  created = []; downloads = [];
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  URL.createObjectURL = vi.fn((blob: Blob) => { created.push(blob); return "blob:audit"; });
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { downloads.push(this.download); });
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-25T03:30:00Z"));
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("the button and its hint", () => {
  it("is always enabled, even with no dates, and the requirement is a hint that keeps its own line", () => {
    setup();
    expect(trigger()).toBeEnabled();
    const hint = screen.getByText("Requiere un rango de fechas · máx. 366 días");
    expect(hint.closest("[data-pf-audit-export-slot]")).toHaveClass("min-h-4");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("says which range will be exported when the filters carry one", () => {
    setup({ from: "2026-11-01", to: "2026-11-04" });
    expect(screen.getByText("Exportación: Del 1 de noviembre de 2026 al 4 de noviembre de 2026")).toBeInTheDocument();
    expect(screen.getByText(/^Exportación:/).closest("[data-pf-audit-export-slot]")).toHaveClass("min-h-4");
  });
});

describe("the panel", () => {
  it("opens with the explanation, the 366 day requirement, the four range choices and the filters that apply", async () => {
    const user = setup({ actor_id: anaId, event_type: ["SessionEnded"], from: "2026-11-01", to: "2026-11-04" });
    const panel = await openPanel(user);
    expect(within(panel).getByText(/La exportación queda registrada en la auditoría/)).toBeInTheDocument();
    expect(within(panel).getByText(/obligatorio, máximo 366 días/)).toBeInTheDocument();
    const range = within(panel).getByRole("group", { name: "Rango de la exportación" });
    for (const label of ["Hoy", "7 días", "30 días", "Personalizado"]) expect(within(range).getByRole("button", { name: label })).toBeInTheDocument();
    expect(within(range).getByRole("button", { name: "Personalizado" })).toHaveAttribute("aria-pressed", "true");
    expect(within(panel).getByLabelText("Desde")).toHaveTextContent("1 de noviembre de 2026");
    const applied = within(panel).getByRole("list", { name: "Filtros que se aplican" });
    expect(applied).toHaveTextContent("Persona: Ana López");
    expect(applied).toHaveTextContent("Acción: Cerró sesión");
    expect(applied).not.toHaveTextContent(/Fecha/);
  });

  it("starts from «30 días» when no range is set, so the export is valid right away, and sends Mexico City days", async () => {
    fetchMock.mockResolvedValue(csv());
    const user = setup();
    const panel = await openPanel(user);
    expect(within(panel).getByRole("button", { name: "30 días" })).toHaveAttribute("aria-pressed", "true");
    expect(within(panel).getByText("Ningún otro filtro: se exportan todas las personas, acciones y vacantes del rango.")).toBeInTheDocument();
    expect(download(panel)).toBeEnabled();
    await user.click(download(panel));
    await waitFor(() => expect(downloads).toEqual(["auditoria-2026-11-04.csv"]));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ from: "2026-10-26", to: "2026-11-24" });
  });

  it("requires both dates and says so inside the panel without calling the API", async () => {
    const user = setup({ from: "2026-11-01" });
    const panel = await openPanel(user);
    expect(within(panel).getByRole("button", { name: "Personalizado" })).toHaveAttribute("aria-pressed", "true");
    expect(within(panel).getByRole("alert")).toHaveTextContent("Elige las fechas «Desde» y «Hasta» para exportar.");
    expect(download(panel)).toBeDisabled();
    await user.click(download(panel));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
  });

  it("refuses a range over 366 days, with the reason next to the dates", async () => {
    const user = setup({ from: "2025-01-01", to: "2026-11-04" });
    const panel = await openPanel(user);
    expect(within(panel).getByRole("alert")).toHaveTextContent("El rango no puede pasar de 366 días. Acórtalo para exportar.");
    expect(download(panel)).toBeDisabled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("accepts exactly 366 days", async () => {
    const user = setup({ from: "2025-11-24", to: "2026-11-24" });
    const panel = await openPanel(user);
    expect(within(panel).queryByRole("alert")).toBeNull();
    expect(download(panel)).toBeEnabled();
  });

  it("refuses an inverted range", async () => {
    const user = setup({ from: "2026-11-05", to: "2026-11-04" });
    const panel = await openPanel(user);
    expect(within(panel).getByRole("alert")).toHaveTextContent("La fecha «Desde» debe ser anterior o igual a «Hasta».");
    expect(download(panel)).toBeDisabled();
  });

  it("keeps the dates on screen when «Personalizado» is chosen, so one end can be adjusted", async () => {
    const user = setup();
    const panel = await openPanel(user);
    await user.click(within(panel).getByRole("button", { name: "Personalizado" }));
    expect(within(panel).getByLabelText("Desde")).toHaveTextContent("26 de octubre de 2026");
    expect(within(panel).getByLabelText("Hasta")).toHaveTextContent("24 de noviembre de 2026");
    expect(download(panel)).toBeEnabled();
  });

  it("lets «Cancelar» close the panel without exporting anything", async () => {
    const user = setup();
    const panel = await openPanel(user);
    await user.click(within(panel).getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("exporting", () => {
  it("POSTs the filters and the range to the same-origin route, downloads under the server's filename and confirms in the panel", async () => {
    fetchMock.mockResolvedValue(csv());
    const user = setup({ actor_id: anaId, event_type: ["SessionEnded"], from: "2026-11-01", to: "2026-11-04" });
    const panel = await openPanel(user);
    await user.click(download(panel));
    await waitFor(() => expect(downloads).toEqual(["auditoria-2026-11-04.csv"]));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/company/audit-events/export");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ actor_id: anaId, event_types: ["SessionEnded"], from: "2026-11-01", to: "2026-11-04" });
    expect(created).toHaveLength(1);
    expect(await within(panel).findByText(/Exportación descargada · queda registrada en la auditoría/)).toBeInTheDocument();
    await user.click(within(panel).getByRole("button", { name: "Listo" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("exports the range chosen in the panel, not the one in the list filters", async () => {
    fetchMock.mockResolvedValue(csv());
    const user = setup({ from: "2026-11-01", to: "2026-11-04" });
    const panel = await openPanel(user);
    await user.click(within(panel).getByRole("button", { name: "Hoy" }));
    await user.click(download(panel));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ from: "2026-11-24", to: "2026-11-24" });
  });

  it("shows the too-large message with row_count and limit in the panel and downloads nothing", async () => {
    fetchMock.mockResolvedValue(Response.json({ error: "audit_export_too_large", code: "audit_export_too_large", row_count: 60123, limit: 50000 }, { status: 422 }));
    const user = setup({ from: "2026-01-01", to: "2026-11-04" });
    const panel = await openPanel(user);
    await user.click(download(panel));
    expect(await within(panel).findByRole("alert")).toHaveTextContent("La exportación tiene 60,123 registros y el límite es 50,000. Acorta el rango de fechas o agrega filtros; no se descargó ningún archivo.");
    expect(created).toHaveLength(0);
    expect(downloads).toHaveLength(0);
    expect(download(panel)).toBeEnabled();
  });

  it.each([
    [403, { code: "forbidden" }, "Solo el dueño de la empresa puede exportar la auditoría."],
    [503, { code: "no_response" }, "No pudimos generar la exportación. No se descargó ningún archivo"],
  ])("maps a %s to a clear message and downloads nothing", async (status, body, message) => {
    fetchMock.mockResolvedValue(Response.json({ error: body.code, ...body }, { status }));
    const user = setup({ from: "2026-11-01", to: "2026-11-04" });
    const panel = await openPanel(user);
    await user.click(download(panel));
    expect(await within(panel).findByRole("alert")).toHaveTextContent(message);
    expect(created).toHaveLength(0);
  });

  it("treats a network failure as an error with no download", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));
    const user = setup({ from: "2026-11-01", to: "2026-11-04" });
    const panel = await openPanel(user);
    await user.click(download(panel));
    expect(await within(panel).findByRole("alert")).toHaveTextContent("No se descargó ningún archivo");
    expect(created).toHaveLength(0);
  });

  it("blocks a second click while the export is running", async () => {
    const pending = deferred<Response>();
    fetchMock.mockReturnValue(pending.promise);
    const user = setup({ from: "2026-11-01", to: "2026-11-04" });
    const panel = await openPanel(user);
    await user.click(download(panel));
    expect(download(panel)).toBeDisabled();
    expect(download(panel)).toHaveTextContent("Descargando…");
    await user.click(download(panel));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => { pending.resolve(csv()); });
    await waitFor(() => expect(downloads).toHaveLength(1));
  });
});
