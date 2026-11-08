import { describe, expect, it } from "vitest";
import {
  companyAccessSchema, deliveriesSchema, placementsSchema, formatMedian, formatRate, metricsAllowed, placementTotal, recruiterDetailSchema,
  recruiterPageSchema, requesterLabel, summarySchema, vacancyPageSchema,
  closuresSchema, complianceSchema, delaysSchema, originSchema,
} from "./model";
import { asOf, closures, compliance, delays, origin, summaryV2 } from "./test-fixtures";
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

describe("contract v2 decoding (stakeholder-metrics v2 §3–§4)", () => {
  it("keeps decoding the v1 summary and accepts the v2 header and summary fields", () => {
    expect(summarySchema.parse(summary())).toEqual(summary());
    const v2 = summarySchema.parse(summaryV2());
    expect(v2.as_of).toBe(asOf);
    expect(v2.previous_period).toEqual({ from: "2026-05-02", to: "2026-07-31" });
    expect(v2.headline?.assigned).toEqual({ current: 42, previous: 38 });
    expect(v2.on_time_by_month).toHaveLength(3);
  });

  it("still rejects drift in the v2 summary: a null headline count or an unknown key", () => {
    const headline = summaryV2().headline!;
    expect(() => summarySchema.parse(summaryV2({ headline: { ...headline, assigned: { current: null, previous: 38 } as never } }))).toThrow();
    expect(() => summarySchema.parse(summaryV2({ headline: { ...headline, median_business_days_to_close: { current: null, previous: null } } }))).not.toThrow();
    expect(() => summarySchema.parse({ ...summaryV2(), score: 1 })).toThrow();
    expect(() => summarySchema.parse({ ...summaryV2(), as_of: "ayer" })).toThrow();
  });

  it("accepts as_of on recruiter pages and the recruiter detail", () => {
    expect(recruiterPageSchema.parse({ ...recruiterPage(), definitions_version: "v2", as_of: asOf }).as_of).toBe(asOf);
    expect(recruiterDetailSchema.parse({ ...recruiterDetail(), definitions_version: "v2", as_of: asOf }).as_of).toBe(asOf);
  });

  it("decodes the closures, compliance, delays and origin sections and rejects drift", () => {
    expect(closuresSchema.parse(closures())).toEqual(closures());
    expect(complianceSchema.parse(compliance())).toEqual(compliance());
    expect(delaysSchema.parse(delays())).toEqual(delays());
    expect(originSchema.parse(origin())).toEqual(origin());
    expect(() => closuresSchema.parse({ ...closures(), extra: 1 })).toThrow();
    expect(() => complianceSchema.parse(compliance({ late_buckets: { up_to_2: 1, from_3_to_5: 1 } as never }))).toThrow();
    expect(() => originSchema.parse(origin({ by_channel: { portal: -1, careers_site: 0, manual: 0, unknown: 0 } }))).toThrow();
  });

  it("decodes an overdue row with or without requester and attributed_to (they arrive with v2b) and caps the top at 4", () => {
    const [first, second] = delaysSchema.parse(delays()).overdue.top;
    expect(first.attributed_to?.[0].name).toBe("Mariana Torres");
    expect(second.requester).toBeUndefined();
    const row = delays().overdue.top[1];
    expect(() => delaysSchema.parse(delays({ overdue: { total: 5, top: [row, row, row, row, row] } }))).toThrow();
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
