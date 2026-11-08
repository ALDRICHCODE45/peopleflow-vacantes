import { describe, expect, it } from "vitest";
import {
  dueLabel, firstName, freshness, greeting, initials, overdueLabel, relativeMoment, scopeLabel, shortfall, stageTone, stalledLabel, trailingAverage,
} from "./format";
import { header, origin } from "./test-fixtures";

describe("header copy", () => {
  it.each([
    ["2026-11-08T11:00:00Z", "Buenas noches"], // 05:00 Mexico City
    ["2026-11-08T12:00:00Z", "Buenos días"], // 06:00
    ["2026-11-08T17:59:00Z", "Buenos días"], // 11:59
    ["2026-11-08T18:00:00Z", "Buenas tardes"], // 12:00
    ["2026-11-09T00:59:00Z", "Buenas tardes"], // 18:59
    ["2026-11-09T01:00:00Z", "Buenas noches"], // 19:00
  ])("greets by Mexico City time at %s", (instant, expected) => { expect(greeting(new Date(instant))).toBe(expected); });

  it("takes the first name, or none", () => {
    expect(firstName("  Mariana Torres López ")).toBe("Mariana");
    expect(firstName("")).toBeNull();
    expect(firstName(undefined)).toBeNull();
  });

  it("names the scope", () => {
    expect(scopeLabel("company")).toBe("Toda la empresa");
    expect(scopeLabel("own_vacancies")).toBe("Tus vacantes asignadas");
  });

  it("says when the numbers were computed and the window, once", () => {
    const now = new Date("2026-11-08T20:00:00Z");
    expect(freshness(header(), now)).toBe("Actualizado hoy 10:42 · 10 oct 2026 – 8 nov 2026");
    expect(freshness({ ...header(), as_of: "2026-11-07T16:42:00Z" }, now)).toMatch(/^Actualizado 7 nov 2026, 10:42/);
  });
});

describe("attention consequences", () => {
  it.each([
    [2, 5, "Faltan 3 de 5 candidatos"], [2, 3, "Falta 1 de 3 candidatos"], [0, 3, "Faltan 3 de 3 candidatos"],
    [0, 0, "Sin meta de candidatos"], [4, 4, "4 de 4 candidatos entregados"],
  ])("delivered %s of %s → %s", (delivered, target, expected) => { expect(shortfall(delivered, target)).toBe(expected); });

  it("counts overdue days and stalled days", () => {
    expect(overdueLabel(6)).toBe("Venció hace 6 días");
    expect(overdueLabel(1)).toBe("Venció hace 1 día");
    expect(overdueLabel(0)).toBe("Vencida");
    expect(stalledLabel(12)).toBe("12 días sin avanzar");
    expect(stalledLabel(1)).toBe("1 día sin avanzar");
  });

  it("names the due day from today (Mexico City)", () => {
    const today = "2026-11-09"; // Monday
    expect(dueLabel("2026-11-09", today)).toEqual({ short: "Vence hoy", long: "vence hoy" });
    expect(dueLabel("2026-11-10", today)).toEqual({ short: "Vence mañana", long: "vence mañana" });
    expect(dueLabel("2026-11-11", today)).toEqual({ short: "Vence mié 11 nov", long: "vence el miércoles 11 de noviembre" });
  });
});

describe("rows", () => {
  it("dates recent rows relative to today in Mexico City", () => {
    const now = new Date("2026-11-08T20:00:00Z");
    expect(relativeMoment("2026-11-08T15:18:00Z", now)).toBe("Hoy, 9:18");
    expect(relativeMoment("2026-11-08T00:05:00Z", now)).toBe("Ayer, 18:05");
    expect(relativeMoment("2026-11-06T22:47:00Z", now)).toBe("6 nov, 16:47");
  });

  it("paints stages in one family: early stages neutral, the rest process", () => {
    expect(["new", "screening", "screening_ok", "discarded"].map(stageTone)).toEqual(Array(4).fill("stage-neutral"));
    expect(["in_process", "custom", "retired", "placement"].map(stageTone)).toEqual(Array(4).fill("stage-process"));
  });

  it("makes initials", () => {
    expect(initials("Héctor Salinas Ruiz")).toBe("HS");
    expect(initials("  ")).toBe("?");
  });
});

describe("7-day trailing average (artboard 09)", () => {
  it("starts at the first full window and keeps the raw sums of each week", () => {
    const days = origin(30).by_day;
    const points = trailingAverage(days);
    expect(points).toHaveLength(24);
    const week = days.slice(0, 7);
    const organic = week.reduce((sum, day) => sum + day.organic, 0);
    const manual = week.reduce((sum, day) => sum + day.manual, 0);
    expect(points[0]).toEqual({ date: days[6].date, from: days[0].date, organic: organic / 7, manual: manual / 7, organicSum: organic, manualSum: manual });
    expect(points.at(-1)?.date).toBe(days.at(-1)?.date);
  });
  it("has no point with fewer than seven days", () => { expect(trailingAverage(origin(7).by_day.slice(0, 6))).toEqual([]); });
});
