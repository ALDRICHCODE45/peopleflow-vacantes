import { describe, expect, it } from "vitest";
import {
  companyAccessSchema, deliveriesSchema, formatMedian, formatRate, metricsAllowed, placementTotal, recruiterDetailSchema,
  recruiterPageSchema, requesterLabel, summarySchema, vacancyPageSchema,
} from "./model";
import { card, carlos, deliveries, fernanda, recruiterDetail, recruiterPage, summary, vacancyPage, vacancyRow } from "./test-fixtures";

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
    expect(formatRate(null)).toEqual({ value: "Sin datos suficientes", detail: null });
  });

  it("separates a zero median from a missing one", () => {
    expect(formatMedian(0)).toBe("0 días hábiles");
    expect(formatMedian(1)).toBe("1 día hábil");
    expect(formatMedian(10.5)).toBe("10.5 días hábiles");
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
