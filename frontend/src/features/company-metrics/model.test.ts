import { describe, expect, it } from "vitest";
import {
  companyAccessSchema, deliveriesSchema, placementsSchema, formatMedian, formatRate, metricsAllowed, placementTotal, recruiterDetailSchema,
  recruiterPageSchema, requesterLabel, summarySchema, vacancyPageSchema,
} from "./model";
import { card, carlos, clientId, deliveries, fernanda, placements, recruiterDetail, recruiterPage, summary, vacancyPage, vacancyRow } from "./test-fixtures";

describe("contract decoding", () => {
  it("accepts the §3.1 summary and rejects drift instead of rendering it", () => {
    expect(summarySchema.parse(summary())).toEqual(summary());
    expect(() => summarySchema.parse({ ...summary(), score: 9 })).toThrow();
    expect(() => summarySchema.parse({ ...summary(), delivery: { ...summary().delivery, on_time: null } })).toThrow();
  });

  it("keeps counts as integers and lets only medians and rate values be null", () => {
    const noSample = summary({ vacancies: { ...summary().vacancies, median_business_days_to_close: null } });
    expect(summarySchema.parse(noSample).vacancies.median_business_days_to_close).toBeNull();
    expect(() => summarySchema.parse(summary({ placements: { ...summary().placements, credits: 1.5 } }))).toThrow();
    expect(recruiterPageSchema.parse(recruiterPage([fernanda()])).items[0].placements.conversion).toEqual({ value: null, numerator: 0, denominator: 0 });
  });

  it("decodes recruiter cards, the dense monthly series and paged vacancies", () => {
    expect(recruiterPageSchema.parse(recruiterPage())).toEqual(recruiterPage());
    expect(recruiterDetailSchema.parse(recruiterDetail()).by_month).toHaveLength(3);
    expect(() => recruiterPageSchema.parse(recruiterPage([{ ...card(), rank: 1 } as never]))).toThrow();
    expect(vacancyPageSchema.parse(vacancyPage()).items[0]).toEqual(vacancyRow());
    expect(deliveriesSchema.parse(deliveries()).items[2].delivered_by).toBeNull();
  });

  it("§3.7: decodes the candidate as {id, full_name} and business_days_late on vacancy rows", () => {
    expect(deliveriesSchema.parse(deliveries()).items[0].candidate).toEqual({ id: "50000000-0000-4000-8000-000000000001", full_name: "Luis Ángel Ramírez Soto" });
    expect(() => deliveriesSchema.parse({ items: [{ ...deliveries().items[0], candidate: "Luis" }] })).toThrow();
    expect(() => placementsSchema.parse({ items: [{ ...placements().items[0], candidate: "Brenda" }] })).toThrow();
    expect(vacancyPageSchema.parse(vacancyPage()).items[0].delivery.business_days_late).toBe(2);
    const withoutLate: Partial<ReturnType<typeof vacancyRow>["delivery"]> = { ...vacancyRow().delivery };
    delete withoutLate.business_days_late;
    expect(() => vacancyPageSchema.parse(vacancyPage([{ ...vacancyRow(), delivery: withoutLate as never }]))).toThrow();
  });

  it("M5: decodes by_requester rows around a nullable requester object, never the flat shape", () => {
    expect(summarySchema.parse(summary()).by_requester.map(row => row.requester)).toEqual([
      { kind: "client", id: clientId, name: "Grupo Bimbo" }, { kind: "client", id: null, name: null }, null,
    ]);
    expect(() => summarySchema.parse(summary({ by_requester: [{ kind: "client", id: clientId, name: "Acme", vacancies: 1, filled: 0 } as never] }))).toThrow();
  });

  it("M3: decodes placement recipients as {person, kind} and rejects a voided credit", () => {
    expect(placementsSchema.parse(placements()).items[0].recipients[0]).toEqual({ person: { user_id: card().user_id, name: "Mariana Torres", former_member: false }, kind: "direct" });
    expect(() => placementsSchema.parse({ items: [{ ...placements().items[0], status: "voided" }] })).toThrow();
  });

  it("rates always arrive as an object: a null rate is a decode failure, a null value is no sample", () => {
    expect(() => summarySchema.parse(summary({ delivery: { ...summary().delivery, on_time_rate: null as never } }))).toThrow();
    expect(() => recruiterPageSchema.parse(recruiterPage([card({ placements: { ...card().placements, conversion: null as never } })]))).toThrow();
    expect(recruiterPageSchema.parse(recruiterPage([fernanda()])).items[0].placements.conversion?.value).toBeNull();
  });

  it("M1: reads the recruiter detail card at the root next to by_month", () => {
    const detail = recruiterDetailSchema.parse(recruiterDetail());
    expect(Object.fromEntries(Object.entries(detail).filter(([key]) => !["by_month", "definitions_version", "period"].includes(key)))).toEqual(card());
    expect(() => recruiterDetailSchema.parse({ definitions_version: "v1", period: recruiterDetail().period, recruiter: card(), by_month: [] })).toThrow();
  });

  it("reads the membership role narrowly, stakeholder included", () => {
    expect(companyAccessSchema.parse({ company_id: "c", role: "stakeholder", can: { view_talent_base: false, view_metrics: true }, company: {} }).role).toBe("stakeholder");
    expect(metricsAllowed("owner")).toBe(true);
    expect(metricsAllowed("stakeholder")).toBe(true);
    expect(metricsAllowed("recruiter")).toBe(false);
  });
});

describe("presentation rules", () => {
  it("shows a rate with its «N de M», and «Sin datos suficientes» without a sample", () => {
    expect(formatRate({ value: 0.6667, numerator: 20, denominator: 30 })).toEqual({ value: "67%", detail: "20 de 30" });
    expect(formatRate({ value: null, numerator: 0, denominator: 0 })).toEqual({ value: "Sin datos suficientes", detail: "0 de 0" });
  });

  it("separates a zero median from a missing one", () => {
    expect(formatMedian(0)).toBe("0 días hábiles");
    expect(formatMedian(1)).toBe("1 día hábil");
    expect(formatMedian(10.5)).toBe("10.5 días hábiles");
    // §3.7.12: an even sample averages the middle pair; integers carry no decimals.
    expect(formatMedian(11.5)).toBe("11.5 días hábiles");
    expect(formatMedian(11)).toBe("11 días hábiles");
    expect(formatMedian(null)).toBe("Sin datos suficientes");
  });

  it("counts placements as direct + participant + shared, never adding did_not_hold on top", () => {
    expect(placementTotal(card().placements)).toBe(9);
    expect(placementTotal(carlos().placements)).toBe(3);
  });

  it("names every requester case", () => {
    expect(requesterLabel({ kind: "client", id: "x", name: "Acme" })).toBe("Acme");
    expect(requesterLabel({ kind: "client", id: null, name: null })).toBe("Cliente sin especificar");
    expect(requesterLabel({ kind: "internal_area", id: null, name: null })).toBe("Área sin especificar");
    expect(requesterLabel(null)).toBe("Sin solicitante");
  });
});
