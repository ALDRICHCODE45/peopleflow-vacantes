import { describe, expect, it } from "vitest";
import { applicationList, candidateList, clientId, deliveryList, draftId, jorge, jorgeId, marianaId, placementList, reassignmentList, vacancyList } from "../test-fixtures";
import { parseDetail } from "./query";
import { detailTitle, figureTitle, filterChips, summaryLine, windowContext } from "./titles";

const state = (search: string) => parseDetail(new URLSearchParams(search))!;
const text = (parts: ReturnType<typeof summaryLine>) => parts.map(([value]) => value).join("");

describe("detail titles (rule 16: the title names the figure)", () => {
  it("names each kind's figure from its filters", () => {
    expect(detailTitle(state("kind=vacancies&scope=closed&closed_month=2026-10"))).toBe("Vacantes cerradas · octubre 2026");
    expect(figureTitle(state("kind=vacancies&scope=closed&close_reason=filled&closing_target=late"))).toBe("Vacantes cubiertas tarde");
    expect(figureTitle(state("kind=deliveries&result=on_time,late,overdue"))).toBe("Entregas con fecha cumplida");
    expect(figureTitle(state(`kind=vacancies&scope=closed_assigned&recruiter_id=${marianaId}&credited_to=${marianaId}`))).toBe("Vacantes cerradas con placement");
    expect(figureTitle(state("kind=deliveries&result=late&late_bucket=over_5"))).toBe("Entregas tarde · más de 5 días hábiles");
    expect(figureTitle(state(`kind=reassignments&recruiter_id=${marianaId}&direction=lost&reason=workload`))).toBe("Reasignaciones perdidas por carga de trabajo");
    expect(figureTitle(state("kind=placements&held=false"))).toBe("Placements que no se sostuvieron");
    expect(figureTitle(state("kind=candidates"))).toBe("Candidatos");
    expect(figureTitle(state("kind=candidates&stage_kind=screening"))).toBe("Candidatos en Screening");
    expect(figureTitle(state("kind=candidates&stage_kind=screening&stalled=true"))).toBe("Candidatos detenidos en Screening");
    expect(figureTitle(state("kind=candidates&stage_kind=screening,screening_ok,in_process,custom,retired"))).toBe("Candidatos en proceso");
    expect(figureTitle(state("kind=candidates&stage_kind=new,screening,screening_ok,in_process,custom,retired"))).toBe("Candidatos");
    expect(figureTitle(state("kind=candidates&stalled=true"))).toBe("Candidatos detenidos");
    expect(figureTitle(state("kind=applications"))).toBe("Postulaciones");
    expect(figureTitle(state("kind=applications&channel=careers_site"))).toBe("Postulaciones del sitio de carreras");
    expect(figureTitle(state("kind=applications&channel=portal,manual"))).toBe("Postulaciones");
  });

  it("uses a name only when it belongs to the filter in the URL, and names what the backend cannot", () => {
    const deliveries = state(`kind=deliveries&recruiter_id=${jorgeId}&attributed_to=${marianaId}&vacancy_id=${draftId}`);
    expect(detailTitle(deliveries, { recruiter: jorge })).toBe("Entregas · Jorge Paredes");
    expect(detailTitle(deliveries, { recruiter: jorge, attributed_to: { user_id: marianaId, name: null, former_member: true }, vacancy: { draft_id: draftId, title: null } }))
      .toBe("Entregas · Persona no disponible · Vacante no disponible");
    expect(detailTitle(deliveries, { recruiter: { ...jorge, user_id: marianaId } })).toBe("Entregas");
    expect(detailTitle(state(`kind=placements&requester_kind=client&requester_id=${clientId}`), { requester: { kind: "client", id: clientId, name: "Grupo Bimbo" } })).toBe("Placements · Grupo Bimbo");
    expect(detailTitle(state("kind=placements&requester_id=none"))).toBe("Placements · Sin solicitante");
    expect(detailTitle(state("kind=placements&requester_kind=internal_area"))).toBe("Placements · Áreas internas");
  });

  it("gives every filter a removable chip; the recruiter chip also removes the direction", () => {
    const chips = filterChips(state(`kind=reassignments&recruiter_id=${jorgeId}&direction=received&reason=other,workload&sort=title`), { recruiter: jorge });
    expect(chips.map(chip => chip.label)).toEqual(["Reclutador: Jorge Paredes", "Dirección: Recibidas", "Motivo: Otro motivo, Carga de trabajo"]);
    expect(chips[0].remove).toEqual(["recruiter_id", "direction"]);
    expect(filterChips(state("kind=candidates"))).toEqual([]);
    expect(filterChips(state("kind=candidates&stage_kind=new,custom&stalled=true")).map(chip => chip.label)).toEqual(["Etapa: Nuevos, Columnas propias", "Solo detenidos"]);
    expect(filterChips(state("kind=applications&channel=portal,unknown")).map(chip => chip.label)).toEqual(["Canal: Portal de vacantes, Portal o sitio, sin distinguir"]);
  });

  it("agrees the summary verb with the count", () => {
    const data = { kind: "deliveries" as const, page: deliveryList({ total: 1, applied_filters: { recruiter: jorge, result: ["on_time"] } }) };
    expect(text(summaryLine(state(`kind=deliveries&recruiter_id=${jorgeId}&result=on_time`), data))).toMatch(/^1 de 5 entregas de Jorge Paredes llegó a tiempo en el periodo — 20\s?%\.$/);
    const one = { kind: "deliveries" as const, page: deliveryList({ total: 1, facets: { result: { on_time: 0, late: 0, overdue: 1, pending: 0, not_configured: 0 } }, applied_filters: { result: ["overdue"] } }) };
    expect(text(summaryLine(state("kind=deliveries&result=overdue"), one))).toMatch(/^1 de 1 entrega está vencida en el periodo — 100\s?%\.$/);
    // «0 de 1 entrega … llegaron» never: one delivery in the universe takes the singular verb.
    const none = { kind: "deliveries" as const, page: deliveryList({ total: 1, facets: { result: { on_time: 0, late: 0, overdue: 1, pending: 0, not_configured: 0 } } }) };
    expect(text(summaryLine(state("kind=deliveries&result=on_time,late,overdue"), none))).toMatch(/^0 de 1 entrega con fecha cumplida llegó a tiempo en el periodo — 0\s?%\.$/);
    expect(text(summaryLine(state("kind=deliveries&result=late"), none))).toMatch(/^0 de 1 entrega llegó tarde en el periodo — 0\s?%\.$/);
  });

  it("says «en el periodo anterior» for a figure opened from «vs periodo anterior»", () => {
    const assigned = { kind: "vacancies" as const, page: vacancyList({ total: 21 }) };
    expect(text(summaryLine(state("kind=vacancies&scope=assigned"), assigned, { previous: true }))).toBe("21 vacantes asignadas en el periodo anterior.");
    const universe = { kind: "deliveries" as const, page: deliveryList({ total: 8, facets: { result: { on_time: 5, late: 2, overdue: 1, pending: 0, not_configured: 0 } } }) };
    expect(text(summaryLine(state("kind=deliveries&result=on_time,late,overdue"), universe, { previous: true })))
      .toMatch(/^5 de 8 entregas con fecha cumplida llegaron a tiempo en el periodo anterior — 63\s?%\.$/);
  });

  it("reads the window against the board it came from: the previous period, or one month of it", () => {
    const today = "2026-11-17";
    const board = encodeURIComponent("/empresa/metricas?from=2026-08-20&to=2026-11-17");
    expect(windowContext(state(`kind=placements&from=2026-05-22&to=2026-08-19&back=${board}`), today)).toEqual({ previous: true, month: null });
    expect(windowContext(state(`kind=placements&from=2026-08-20&to=2026-11-17&back=${board}`), today)).toEqual({ previous: false, month: null });
    expect(windowContext(state("kind=placements&from=2026-05-22&to=2026-08-19"), today)).toEqual({ previous: false, month: null });
    const page = encodeURIComponent(`/empresa/metricas/reclutadores/${marianaId}?from=2026-08-20&to=2026-11-17`);
    expect(windowContext(state(`kind=vacancies&scope=assigned&from=2026-08-20&to=2026-08-31&back=${page}`), today)).toEqual({ previous: false, month: "2026-08" });
    expect(windowContext(state(`kind=vacancies&scope=assigned&from=2026-09-01&to=2026-09-30&back=${page}`), today)).toEqual({ previous: false, month: "2026-09" });
    expect(windowContext(state(`kind=vacancies&scope=assigned&from=2026-11-01&to=2026-11-17&back=${page}`), today)).toEqual({ previous: false, month: "2026-11" });
    // Not a whole month of the board's window: no month is named.
    expect(windowContext(state(`kind=vacancies&scope=assigned&from=2026-09-02&to=2026-09-30&back=${page}`), today)).toEqual({ previous: false, month: null });
  });

  it("names the month of a monthly figure in the summary instead of «en el periodo»", () => {
    const diego = { ...jorge, user_id: marianaId, name: "Diego Navarro" };
    const assigned = { kind: "vacancies" as const, page: vacancyList({ total: 6, applied_filters: { recruiter: diego } }) };
    expect(text(summaryLine(state(`kind=vacancies&scope=assigned&recruiter_id=${marianaId}`), assigned, { month: "2026-09" })))
      .toBe("6 vacantes asignadas a Diego Navarro en septiembre 2026.");
    expect(text(summaryLine(state("kind=placements"), { kind: "placements", page: placementList({ total: 1 }) }, { month: "2026-11" }))).toBe("1 placement en noviembre 2026.");
  });

  it("names the month of a company board monthly bar (commitment_month, closed_month) in the summary", () => {
    const deliveries = { kind: "deliveries" as const, page: deliveryList({ total: 2, facets: { result: { on_time: 0, late: 0, overdue: 2, pending: 0, not_configured: 0 } } }) };
    const commitment = text(summaryLine(state("kind=deliveries&result=on_time%2Clate%2Coverdue&commitment_month=2026-11"), deliveries));
    expect(commitment).toContain("llegaron a tiempo en noviembre 2026 — ");
    expect(commitment).not.toContain("en el periodo");
    const closed = text(summaryLine(state("kind=vacancies&scope=closed&closed_month=2026-08"), { kind: "vacancies", page: vacancyList({ total: 3 }) }));
    expect(closed).toMatch(/ en agosto 2026\.$/);
  });

  it("counts a late bucket without comparing it with itself", () => {
    const bucket = { kind: "deliveries" as const, page: deliveryList({ total: 1, facets: { result: { on_time: 0, late: 1, overdue: 0, pending: 0, not_configured: 0 } }, applied_filters: { result: ["late"] } }) };
    expect(text(summaryLine(state("kind=deliveries&result=late&late_bucket=up_to_2"), bucket))).toBe("1 entrega llegó con hasta 2 días hábiles de retraso en el periodo.");
    const three = { kind: "deliveries" as const, page: deliveryList({ total: 3, facets: { result: { on_time: 0, late: 3, overdue: 0, pending: 0, not_configured: 0 } }, applied_filters: { attributed_to: jorge, result: ["late"] } }) };
    expect(text(summaryLine(state(`kind=deliveries&result=late&late_bucket=over_5&attributed_to=${jorgeId}`), three)))
      .toBe("3 entregas de Jorge Paredes llegaron con más de 5 días hábiles de retraso en el periodo.");
  });

  it("names the month of a monthly figure in the title", () => {
    const mariana = { ...jorge, user_id: marianaId, name: "Mariana Torres" };
    expect(detailTitle(state(`kind=vacancies&scope=assigned&recruiter_id=${marianaId}`), { recruiter: mariana }, { previous: false, month: "2026-09" }))
      .toBe("Vacantes asignadas · Mariana Torres · septiembre 2026");
  });

  it("names the figure instead of «registros», in a sentence", () => {
    const deliveries = { kind: "deliveries" as const, page: deliveryList({ total: 1 }) };
    expect(text(summaryLine(state("kind=deliveries&result=late,overdue"), deliveries))).toBe("1 entrega en el periodo.");
    expect(text(summaryLine(state("kind=deliveries"), { ...deliveries, page: deliveryList({ total: 11 }) }))).toBe("11 entregas en el periodo.");
    expect(text(summaryLine(state("kind=vacancies&scope=assigned"), { kind: "vacancies", page: vacancyList({ total: 29 }) }))).toBe("29 vacantes asignadas en el periodo.");
    expect(text(summaryLine(state("kind=vacancies&scope=assigned"), { kind: "vacancies", page: vacancyList({ total: 1 }) }))).toBe("1 vacante asignada en el periodo.");
    expect(text(summaryLine(state(`kind=vacancies&scope=assigned&recruiter_id=${marianaId}`), { kind: "vacancies", page: vacancyList({ total: 2, applied_filters: { recruiter: { ...jorge, user_id: marianaId, name: "Mariana Torres" } } }) })))
      .toBe("2 vacantes asignadas a Mariana Torres en el periodo.");
    expect(text(summaryLine(state("kind=vacancies"), { kind: "vacancies", page: vacancyList({ total: 1 }) }))).toBe("1 vacante en el periodo.");
    expect(text(summaryLine(state("kind=placements&held=false"), { kind: "placements", page: placementList({ total: 2 }) }))).toBe("2 placements que no se sostuvieron en el periodo.");
    expect(text(summaryLine(state("kind=reassignments"), { kind: "reassignments", page: reassignmentList({ total: 1 }) }))).toBe("1 reasignación en el periodo.");
  });

  it("names the on-time deliveries behind «40% a tiempo» and the closed vacancies with placement behind «100% de conversión»", () => {
    const universe = { kind: "deliveries" as const, page: deliveryList({ total: 5, facets: { result: { on_time: 2, late: 2, overdue: 1, pending: 3, not_configured: 0 } } }) };
    expect(text(summaryLine(state("kind=deliveries&result=on_time,late,overdue"), universe))).toMatch(/^2 de 5 entregas con fecha cumplida llegaron a tiempo en el periodo — 40\s?%\.$/);
    expect(text(summaryLine(state(`kind=deliveries&result=on_time,late,overdue&attributed_to=${jorgeId}`), { ...universe, page: { ...universe.page, applied_filters: { attributed_to: jorge } } })))
      .toMatch(/^2 de 5 entregas con fecha cumplida de Jorge Paredes llegaron a tiempo en el periodo — 40\s?%\.$/);
    const mariana = { ...jorge, user_id: marianaId, name: "Mariana Torres" };
    const conversion = state(`kind=vacancies&scope=closed_assigned&recruiter_id=${marianaId}&credited_to=${marianaId}`);
    const credited = { kind: "vacancies" as const, page: vacancyList({ total: 3, applied_filters: { recruiter: mariana, credited_to: mariana } }) };
    // Until the closed vacancies are counted, the line names the figure alone.
    expect(text(summaryLine(conversion, credited))).toBe("3 vacantes cerradas con placement de Mariana Torres en el periodo.");
    // With them, the same «N de M … — X %» as the on-time rate.
    expect(text(summaryLine(conversion, credited, { closedTotal: 4 }))).toMatch(/^3 de 4 vacantes cerradas de Mariana Torres tuvieron placement en el periodo — 75\s?%\.$/);
    expect(text(summaryLine(conversion, { ...credited, page: vacancyList({ total: 1, applied_filters: { recruiter: mariana, credited_to: mariana } }) }, { closedTotal: 1 })))
      .toMatch(/^1 de 1 vacante cerrada de Mariana Torres tuvo placement en el periodo — 100\s?%\.$/);
  });

  it("counts vacancies without a delivery target as vacancies, like the board's «vacantes sin meta configurada»", () => {
    const data = { kind: "deliveries" as const, page: deliveryList({ total: 5, facets: { result: { on_time: 2, late: 2, overdue: 1, pending: 1, not_configured: 5 } } }) };
    expect(text(summaryLine(state("kind=deliveries&result=not_configured"), data))).toMatch(/^5 de 11 vacantes no tienen meta de entrega en el periodo — 45\s?%\.$/);
  });

  it("counts candidates today and applications by their sum, not by the rows", () => {
    expect(text(summaryLine(state("kind=candidates&stalled=true"), { kind: "candidates", page: candidateList() }))).toBe("2 candidatos detenidos hoy.");
    expect(text(summaryLine(state("kind=candidates"), { kind: "candidates", page: candidateList({ total: 1 }) }))).toBe("1 candidato hoy.");
    expect(text(summaryLine(state("kind=applications"), { kind: "applications", page: applicationList() }))).toBe("154 postulaciones en el periodo.");
    expect(text(summaryLine(state("kind=applications"), { kind: "applications", page: applicationList({ total: 1 }) }))).toBe("1 postulación en el periodo.");
    expect(text(summaryLine(state("kind=applications&channel=careers_site"), { kind: "applications", page: applicationList({ total: 14 }) }))).toBe("14 postulaciones del sitio de carreras en el periodo.");
  });
});
