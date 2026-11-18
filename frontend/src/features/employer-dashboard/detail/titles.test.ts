import { describe, expect, it } from "vitest";
import { parseDashboardDetail } from "./query";
import { dashboardApplications, dashboardCandidates, dashboardDeliveries, dashboardVacancies, draftId } from "./test-fixtures";
import { detailTitle, figureTitle, filterChips, freshnessLine, summaryLine } from "./titles";

const state = (search: string) => parseDashboardDetail(new URLSearchParams(search))!;
const text = (parts: readonly (readonly [string, boolean])[]) => parts.map(([part]) => part).join("");

describe("dashboard detail words", () => {
  it("names each figure the board opens", () => {
    expect(figureTitle(state("kind=candidates&in_process=true"))).toBe("Candidatos en proceso");
    expect(figureTitle(state("kind=candidates&stalled=true"))).toBe("Candidatos detenidos");
    expect(figureTitle(state("kind=candidates&stage_kind=screening&stalled=true"))).toBe("Candidatos detenidos en Screening");
    expect(figureTitle(state("kind=candidates&stage_kind=new,screening"))).toBe("Candidatos");
    expect(figureTitle(state("kind=deliveries&state=overdue"))).toBe("Entregas vencidas");
    expect(figureTitle(state("kind=deliveries&state=due_this_week"))).toBe("Entregas que vencen esta semana");
    expect(figureTitle(state("kind=deliveries"))).toBe("Entregas por atender");
    expect(figureTitle(state("kind=vacancies&status=published"))).toBe("Vacantes publicadas");
    expect(figureTitle(state("kind=vacancies&status=published&sort=positions_open"))).toBe("Posiciones de las vacantes publicadas");
    expect(figureTitle(state("kind=vacancies"))).toBe("Vacantes");
    expect(figureTitle(state("kind=applications&channel=portal,careers_site,unknown"))).toBe("Postulaciones orgánicas");
    expect(figureTitle(state("kind=applications&channel=manual"))).toBe("Postulaciones de registro manual");
    expect(figureTitle(state("kind=applications"))).toBe("Postulaciones");
  });

  it("adds the vacancy (only when the API named this id) and the day or days", () => {
    const vacancy = state(`kind=candidates&in_process=true&vacancy_id=${draftId}&on=2026-10-12`);
    expect(detailTitle(vacancy)).toBe("Candidatos en proceso · 12 oct 2026");
    expect(detailTitle(vacancy, { vacancy: { draft_id: draftId, title: "Analista de crédito Sr." } })).toBe("Candidatos en proceso · Analista de crédito Sr. · 12 oct 2026");
    expect(detailTitle(vacancy, { vacancy: { draft_id: draftId, title: null } })).toBe("Candidatos en proceso · Vacante no disponible · 12 oct 2026");
    expect(detailTitle(state("kind=applications&from=2026-11-01&to=2026-11-01&channel=manual"))).toBe("Postulaciones de registro manual · 1 nov 2026");
    expect(detailTitle(state("kind=applications&from=2026-11-01&to=2026-11-05"))).toBe("Postulaciones · 1 nov 2026 – 5 nov 2026");
  });

  it("offers one removable chip per filter; in_process takes its day with it, the dates go together", () => {
    const chips = filterChips(state(`kind=candidates&in_process=true&on=2026-10-12&stage_kind=screening&stalled=true&vacancy_id=${draftId}`));
    expect(chips.map(chip => [chip.label, chip.remove])).toEqual([
      ["Vacante: …", ["vacancy_id"]], ["En proceso", ["in_process", "on"]], ["Al cierre del 12 oct 2026", ["on"]],
      ["Etapa: Screening", ["stage_kind"]], ["Solo detenidos", ["stalled"]],
    ]);
    expect(filterChips(state("kind=applications&from=2026-11-01&to=2026-11-05&channel=manual")).map(chip => [chip.label, chip.remove])).toEqual([
      ["Fechas: 1 nov 2026 – 5 nov 2026", ["from", "to"]], ["Canal: Manual", ["channel"]],
    ]);
    expect(filterChips(state("kind=deliveries&state=due_this_week")).map(chip => chip.label)).toEqual(["Estado: Vencen esta semana"]);
    expect(filterChips(state("kind=vacancies&status=published&sort=title")).map(chip => chip.label)).toEqual(["Estado: Publicadas"]);
  });

  it("counts the records in one line", () => {
    expect(text(summaryLine(state("kind=candidates&in_process=true"), { kind: "candidates", page: dashboardCandidates({ total: 14 }) }))).toBe("14 candidatos en proceso hoy.");
    expect(text(summaryLine(state("kind=candidates&in_process=true&on=2026-10-12"), { kind: "candidates", page: dashboardCandidates({ total: 1 }) }))).toBe("1 candidato en proceso al cierre del 12 oct 2026.");
    expect(text(summaryLine(state("kind=candidates&stalled=true"), { kind: "candidates", page: dashboardCandidates() }))).toBe("2 candidatos detenidos hoy.");
    expect(text(summaryLine(state("kind=deliveries&state=overdue"), { kind: "deliveries", page: dashboardDeliveries() }))).toBe("2 entregas vencidas hoy.");
    expect(text(summaryLine(state("kind=deliveries&state=due_this_week"), { kind: "deliveries", page: dashboardDeliveries({ total: 1 }) }))).toBe("1 entrega vence esta semana.");
    expect(text(summaryLine(state("kind=vacancies&status=published"), { kind: "vacancies", page: dashboardVacancies() }))).toBe("2 vacantes publicadas hoy.");
    expect(text(summaryLine(state("kind=vacancies&status=published&sort=positions_open"), { kind: "vacancies", page: dashboardVacancies({ total: 8, positions: { covered: 2, required: 14 } }) })))
      .toBe("2 de 14 posiciones cubiertas en 8 vacantes publicadas; 12 por cubrir.");
    expect(text(summaryLine(state("kind=applications"), { kind: "applications", page: dashboardApplications() }))).toBe("154 postulaciones en el periodo.");
    // The summary names the figure it came from: the board's «Orgánicas» and «Manuales».
    expect(text(summaryLine(state("kind=applications&channel=portal,careers_site,unknown"), { kind: "applications", page: dashboardApplications({ total: 14 }) }))).toBe("14 postulaciones orgánicas en el periodo.");
    expect(text(summaryLine(state("kind=applications&channel=manual"), { kind: "applications", page: dashboardApplications({ total: 1 }) }))).toBe("1 postulación de registro manual en el periodo.");
  });

  it("says what the list covers: a window for applications and past days, today for the rest, and a recruiter's own scope", () => {
    const page = dashboardApplications();
    expect(freshnessLine(state("kind=applications&window=30"), page)).toMatch(/^Actualizado .+ · Últimos 30 días \(10 oct 2026 – 8 nov 2026\) · Definiciones d2$/);
    expect(freshnessLine(state("kind=deliveries&window=30"), { ...dashboardDeliveries(), scope: "own_vacancies" })).toMatch(/· Foto de hoy · Solo tus vacantes · Definiciones d2$/);
    expect(freshnessLine(state("kind=candidates&window=7&in_process=true&on=2026-11-03"), null)).toBe("Últimos 7 días");
  });
});
