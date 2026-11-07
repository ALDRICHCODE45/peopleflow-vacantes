import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("./actions", () => ({ listVacanciesAction: vi.fn(), listReassignmentsAction: vi.fn(), loadAuditedDetailAction: vi.fn() }));
vi.mock("./audited-detail-sheet", async importOriginal => {
  const actual = await importOriginal<typeof import("./audited-detail-sheet")>();
  return { ...actual, AuditedDetailSheet: vi.fn(actual.AuditedDetailSheet) };
});
import { listReassignmentsAction, listVacanciesAction, loadAuditedDetailAction } from "./actions";
import { AuditedDetailSheet } from "./audited-detail-sheet";
import { DetailLists } from "./detail-lists";
import type { MetricsFailure } from "./model";
import { deliveries, draftId, marianaId, placements, reassignmentPage, vacancyPage, vacancyRow } from "./test-fixtures";

const vacancies = vi.mocked(listVacanciesAction);
const detail = vi.mocked(loadAuditedDetailAction);
const failure = (reason: MetricsFailure["reason"]): MetricsFailure => ({ ok: false, reason, reference: {} });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }

beforeEach(() => {
  vi.resetAllMocks();
  vacancies.mockResolvedValue({ ok: true, data: vacancyPage() });
  vi.mocked(listReassignmentsAction).mockResolvedValue({ ok: true, data: reassignmentPage() });
});
afterEach(cleanup);

describe("detail lists", () => {
  it("lists the period's vacancies without personal data, with the delivery against its renegotiated date", async () => {
    render(<DetailLists filters={{ recruiter_id: marianaId }} />);
    expect(await screen.findByText("Supervisor de Producción")).toBeInTheDocument();
    expect(vacancies).toHaveBeenCalledWith({ filters: { recruiter_id: marianaId } });
    expect(screen.getByText("Grupo Bimbo · Cliente")).toBeInTheDocument();
    expect(screen.getByText("Tarde · 2 días hábiles")).toBeInTheDocument();
    expect(screen.getByText("7 de 6 · compromiso 26 ago 2026 (antes 19 ago 2026)")).toBeInTheDocument();
    expect(screen.getByText("Cubierta")).toBeInTheDocument();
    expect(screen.getByText("2 de 2")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Acciones de Supervisor de Producción" })).toHaveAttribute("aria-haspopup", "menu");
  });

  it("appends the next page with «Cargar más» and keeps the shown rows while it loads", async () => {
    const second = vacancyRow({ draft_id: "30000000-0000-4000-8000-000000000002", title: "Contador General", closes: [], requester: null, responsible: null,
      delivery: { ...vacancyRow().delivery, result: "on_time", business_days_late: null } });
    vacancies.mockResolvedValueOnce({ ok: true, data: vacancyPage([vacancyRow()], "c2" ) }).mockResolvedValueOnce({ ok: true, data: vacancyPage([second]) });
    render(<DetailLists filters={{}} />);
    await userEvent.click(await screen.findByRole("button", { name: "Cargar más" }));
    expect(await screen.findByText("Contador General")).toBeInTheDocument();
    expect(screen.getByText("Supervisor de Producción")).toBeInTheDocument();
    expect(vacancies).toHaveBeenLastCalledWith({ filters: {}, cursor: "c2" });
    expect(screen.getByText("Sin solicitante · No aplica")).toBeInTheDocument();
    expect(screen.getByText("Sin responsable")).toBeInTheDocument();
    expect(screen.getByText("Abierta")).toBeInTheDocument();
    expect(screen.getByText("A tiempo")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cargar más" })).not.toBeInTheDocument();
  });

  it("restarts from the first page when the cursor went stale", async () => {
    vacancies.mockResolvedValueOnce({ ok: true, data: vacancyPage([vacancyRow()], "old") }).mockResolvedValueOnce(failure("invalid_cursor"));
    render(<DetailLists filters={{}} />);
    await userEvent.click(await screen.findByRole("button", { name: "Cargar más" }));
    expect(await screen.findByText("La lista se actualizó. Volvimos a la primera página.")).toBeInTheDocument();
    expect(vacancies).toHaveBeenCalledTimes(3);
  });

  // Opening the row menu over the full table takes jsdom tens of seconds, so the thread is checked at the sheet's props.
  it("hands the audited detail the list's applied period only", async () => {
    render(<DetailLists filters={{ from: "2026-08-01", to: "2026-10-31", recruiter_id: marianaId }} />);
    await screen.findByText("Supervisor de Producción");
    expect(vi.mocked(AuditedDetailSheet).mock.lastCall?.[0]).toMatchObject({ target: null, period: { from: "2026-08-01", to: "2026-10-31" } });
  });

  it("reads reassignments only when their tab opens, and names former members", async () => {
    render(<DetailLists filters={{}} />);
    await screen.findByText("Supervisor de Producción");
    expect(listReassignmentsAction).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("tab", { name: "Reasignaciones" }));
    expect(await screen.findByText("Salida del reclutador")).toBeInTheDocument();
    expect(screen.getByText("Carlos Mendoza Ruiz · Ex miembro")).toBeInTheDocument();
    expect(screen.getByText("21 días hábiles")).toBeInTheDocument();
  });
});

describe("audited detail", () => {
  const target = { report: "deliveries" as const, vacancy: vacancyRow({ delivery: { ...vacancyRow().delivery, target: 2 } }) };
  const period = { from: "2026-08-01", to: "2026-10-31" };

  it("asks first, then shows the names in order with the audit footer", async () => {
    detail.mockResolvedValue({ ok: true, data: { report: "deliveries", items: deliveries().items } });
    render(<AuditedDetailSheet target={target} period={period} onClose={() => {}} />);
    const sheet = await screen.findByRole("dialog", { name: "Candidatos entregados" });
    expect(within(sheet).getByText("Esta consulta queda registrada en la auditoría de la empresa.")).toBeInTheDocument();
    expect(within(sheet).queryByText("Luis Ángel Ramírez Soto")).not.toBeInTheDocument();
    expect(detail).not.toHaveBeenCalled();
    await userEvent.click(within(sheet).getByRole("button", { name: "Ver candidatos entregados" }));
    expect(detail).toHaveBeenCalledWith({ report: "deliveries", draftId, period });
    expect(await screen.findByText("Luis Ángel Ramírez Soto")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Candidatos entregados · 3" })).toBeInTheDocument();
    expect(screen.getByText("Completó la meta · tarde")).toBeInTheDocument();
    // M3: an organic application that landed in the cutoff stage credits no recruiter.
    expect(screen.getByText("Postulación directa")).toBeInTheDocument();
    expect(screen.getByText("Ex miembro")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/^Consulta registrada en Auditoría · /);
  });

  it("fails closed: an unrecorded read shows no names and offers a retry", async () => {
    const retry = deferred<Awaited<ReturnType<typeof loadAuditedDetailAction>>>();
    detail.mockResolvedValueOnce(failure("server_error")).mockReturnValueOnce(retry.promise);
    render(<AuditedDetailSheet target={target} period={period} onClose={() => {}} />);
    await userEvent.click(await screen.findByRole("button", { name: "Ver candidatos entregados" }));
    expect(await screen.findByText("No pudimos registrar la consulta")).toBeInTheDocument();
    expect(screen.getByText("Por eso no mostramos los nombres: sin registro no hay datos. Nada cambió en la vacante. Vuelve a intentarlo.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByText(/Consulta registrada en Auditoría/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(screen.getByRole("status", { name: "Cargando candidatos entregados" })).toBeInTheDocument();
    retry.resolve({ ok: true, data: { report: "deliveries", items: [] } });
    expect(await screen.findByText("Esta vacante aún no tiene candidatos entregados")).toBeInTheDocument();
    expect(screen.getByText("Nadie ha llegado a la etapa de corte. La consulta quedó registrada aunque no hubiera nombres.")).toBeInTheDocument();
  });

  it.each([
    ["a 422 invalid_filter", { ok: false, reason: "invalid_filter", reference: { status: 422, code: "invalid_filter" } }],
    ["a 400", { ok: false, reason: "unrecognized_response", reference: { status: 400 } }],
  ] as const)("tells a rejected period apart from an unrecorded read on %s, still without names", async (_, result) => {
    detail.mockResolvedValue(result);
    render(<AuditedDetailSheet target={target} period={period} onClose={() => {}} />);
    await userEvent.click(await screen.findByRole("button", { name: "Ver candidatos entregados" }));
    expect(await screen.findByText("No pudimos abrir este detalle con el periodo elegido")).toBeInTheDocument();
    expect(screen.getByText("Revisa el periodo e inténtalo de nuevo. No se mostró ningún dato.")).toBeInTheDocument();
    expect(screen.queryByText("No pudimos registrar la consulta")).not.toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByText(/Consulta registrada en Auditoría/)).not.toBeInTheDocument();
  });

  it.each(["no_response", "unrecognized_response"] as const)("fails closed on %s", async reason => {
    detail.mockResolvedValue(failure(reason));
    render(<AuditedDetailSheet target={target} period={period} onClose={() => {}} />);
    await userEvent.click(await screen.findByRole("button", { name: "Ver candidatos entregados" }));
    expect(await screen.findByText("No pudimos registrar la consulta")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("shows placements with their credit and whether they held", async () => {
    detail.mockResolvedValue({ ok: true, data: { report: "placements", items: placements().items } });
    render(<AuditedDetailSheet target={{ ...target, report: "placements" }} period={period} onClose={() => {}} />);
    await userEvent.click(await screen.findByRole("button", { name: "Ver placements" }));
    expect(await screen.findByText("Brenda Sánchez Villegas")).toBeInTheDocument();
    expect(screen.getByText("No se sostuvo")).toBeInTheDocument();
    expect(screen.getByText("participación")).toBeInTheDocument();
    expect(screen.getByText("Carlos Mendoza Ruiz")).toBeInTheDocument();
    expect(screen.getByText("Ex miembro")).toBeInTheDocument();
  });

  it("closes from «Cancelar» without reading anything", async () => {
    const onClose = vi.fn();
    render(<AuditedDetailSheet target={target} period={period} onClose={onClose} />);
    await userEvent.click(await screen.findByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(detail).not.toHaveBeenCalled();
  });
});
