import { describe, expect, it } from "vitest";
import { applicationList, candidateList, clientId, deliveryList, draftId, jorge, jorgeId, marianaId } from "../test-fixtures";
import { parseDetail } from "./query";
import { detailTitle, figureTitle, filterChips, summaryLine } from "./titles";

const state = (search: string) => parseDetail(new URLSearchParams(search))!;
const text = (parts: ReturnType<typeof summaryLine>) => parts.map(([value]) => value).join("");

describe("detail titles (rule 16: the title names the figure)", () => {
  it("names each kind's figure from its filters", () => {
    expect(detailTitle(state("kind=vacancies&scope=closed&closed_month=2026-10"))).toBe("Vacantes cerradas · octubre 2026");
    expect(figureTitle(state("kind=vacancies&scope=closed&close_reason=filled&closing_target=late"))).toBe("Vacantes cubiertas tarde");
    expect(figureTitle(state("kind=deliveries&result=on_time,late,overdue"))).toBe("Entregas");
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
    expect(text(summaryLine(state("kind=deliveries&result=late,overdue"), data))).toBe("1 registro");
  });

  it("counts candidates today and applications by their sum, not by the rows", () => {
    expect(text(summaryLine(state("kind=candidates&stalled=true"), { kind: "candidates", page: candidateList() }))).toBe("2 candidatos detenidos hoy.");
    expect(text(summaryLine(state("kind=candidates"), { kind: "candidates", page: candidateList({ total: 1 }) }))).toBe("1 candidato hoy.");
    expect(text(summaryLine(state("kind=applications"), { kind: "applications", page: applicationList() }))).toBe("154 postulaciones en el periodo.");
    expect(text(summaryLine(state("kind=applications"), { kind: "applications", page: applicationList({ total: 1 }) }))).toBe("1 postulación en el periodo.");
  });
});
