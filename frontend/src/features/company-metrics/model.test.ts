import { describe, expect, it } from "vitest";
import {
  companyAccessSchema, deliveriesSchema, placementsSchema, formatMedian, formatRate, metricsAllowed, placementTotal, recruiterDetailSchema,
  recruiterPageSchema, requesterLabel, summarySchema, vacancyPageSchema,
  closuresSchema, complianceSchema, delaysSchema, originSchema,
} from "./model";
import { asOf, closures, compliance, delays, origin, summaryV2 } from "./test-fixtures";
import { deliveryListSchema, placementListSchema, reassignmentListSchema, vacancyListSchema } from "./model";
import { deliveryList, placementList, reassignmentList, vacancyList } from "./test-fixtures";
import { applicationListSchema, candidateListSchema, pipelineSchema, STAGE_KIND_LABEL } from "./model";
import { applicationList, candidateList, pipeline } from "./test-fixtures";
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

describe("v2 §5 detail lists", () => {
  it("decodes total, facets, applied filters, rows and the cursor of every list kind", () => {
    expect(deliveryListSchema.parse(deliveryList())).toEqual(deliveryList());
    expect(vacancyListSchema.parse(vacancyList())).toEqual(vacancyList());
    expect(placementListSchema.parse(placementList())).toEqual(placementList());
    expect(reassignmentListSchema.parse(reassignmentList())).toEqual(reassignmentList());
  });

  it("ignores extra row keys but rejects a missing total or facet", () => {
    const extra = deliveryList({ items: [{ ...deliveryList().items[0], renegotiations: 1, original_commitment_date: null } as never] });
    expect(deliveryListSchema.safeParse(extra).success).toBe(true);
    expect(deliveryListSchema.safeParse({ ...deliveryList(), total: undefined }).success).toBe(false);
    expect(deliveryListSchema.safeParse({ ...deliveryList(), facets: {} }).success).toBe(false);
  });

  it("accepts null names for ids of another company, «sin solicitante», a kind alone and held as a boolean", () => {
    const applied = {
      recruiter: { user_id: "10000000-0000-4000-8000-000000000009", name: null, former_member: true },
      vacancy: { draft_id: "30000000-0000-4000-8000-000000000009", title: null }, requester: "none", held: false,
    };
    expect(placementListSchema.parse(placementList({ applied_filters: applied as never, total: 0, items: [] })).applied_filters).toEqual(applied);
    expect(deliveryListSchema.parse(deliveryList({ applied_filters: { requester_kind: "client" } })).applied_filters).toEqual({ requester_kind: "client" });
  });
});

describe("v2c pipeline and its lists (§4.4, §5.5, §5.6)", () => {
  it("decodes the pipeline section strictly, with as_of required", () => {
    expect(pipelineSchema.parse(pipeline())).toEqual(pipeline());
    const retired = pipeline({ stages: [...pipeline().stages, { kind: "retired", candidates: 1, median_business_days_in_stage: 2, stalled: 1 }] });
    expect(pipelineSchema.parse(retired)).toEqual(retired);
    expect(pipelineSchema.safeParse({ ...pipeline(), as_of: undefined }).success).toBe(false);
    expect(pipelineSchema.safeParse({ ...pipeline(), score: 1 }).success).toBe(false);
    expect(pipelineSchema.safeParse(pipeline({ stages: [{ kind: "discarded" as never, candidates: 1, median_business_days_in_stage: 1, stalled: 0 }] })).success).toBe(false);
    expect(pipelineSchema.safeParse(pipeline({ stages: [{ kind: "new", candidates: 1, median_business_days_in_stage: 1, stalled: null as never }] })).success).toBe(false);
    expect(pipelineSchema.safeParse(pipeline({ top_vacancies: Array(6).fill(pipeline().top_vacancies[0]) })).success).toBe(false);
  });

  it("decodes the candidates and applications lists, retired only when present", () => {
    expect(candidateListSchema.parse(candidateList())).toEqual(candidateList());
    const withRetired = candidateList({ facets: { stage_kind: { ...candidateList().facets.stage_kind, retired: 1 }, stalled: 0 } });
    expect(candidateListSchema.parse(withRetired)).toEqual(withRetired);
    expect(candidateListSchema.safeParse({ ...candidateList(), facets: { stage_kind: candidateList().facets.stage_kind } }).success).toBe(false);
    expect(applicationListSchema.parse(applicationList())).toEqual(applicationList());
    expect(applicationListSchema.safeParse({ ...applicationList(), facets: {} }).success).toBe(false);
  });

  it("names every stage kind with the pipeline's own words", () => {
    expect(STAGE_KIND_LABEL).toEqual({
      new: "Nuevos", screening: "Screening", screening_ok: "Screening OK", in_process: "En proceso", custom: "Columnas propias", placement: "Placement", retired: "Columnas retiradas",
    });
  });
});

describe("replacement keys on the strict vacancy refs (deployment step 1)", () => {
  const keys = { kind: "replacement", root_draft_id: "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d8e", sequence: 1 };
  const original = { kind: "original", root_draft_id: "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d8e", sequence: null };
  const withKeys = (ref: object, extra: object) => ({ ...ref, ...extra });
  it.each([keys, original])("parses pipeline.top_vacancies[].vacancy and delays.overdue.top[].vacancy with %j", extra => {
    const pipe = pipeline(); const pipeWith = { ...pipe, top_vacancies: pipe.top_vacancies.map(row => ({ ...row, vacancy: withKeys(row.vacancy, extra) })) };
    expect(pipelineSchema.parse(pipeWith)).toEqual(pipeWith);
    const del = delays(); const delWith = { ...del, overdue: { ...del.overdue, top: del.overdue.top.map(row => ({ ...row, vacancy: withKeys(row.vacancy, extra) })) } };
    expect(delaysSchema.parse(delWith)).toEqual(delWith);
  });
  it("still parses both without the keys", () => {
    expect(pipelineSchema.parse(pipeline())).toEqual(pipeline());
    expect(delaysSchema.parse(delays())).toEqual(delays());
  });
  it.each([{ kind: "clone" }, { sequence: 0 }, { sequence: "1" }, { root_draft_id: null }, { extra: true }])("rejects bad vacancy keys %j", patch => {
    const pipe = pipeline();
    expect(pipelineSchema.safeParse({ ...pipe, top_vacancies: pipe.top_vacancies.map(row => ({ ...row, vacancy: { ...row.vacancy, ...keys, ...patch } })) }).success).toBe(false);
    const del = delays();
    expect(delaysSchema.safeParse({ ...del, overdue: { ...del.overdue, top: del.overdue.top.map(row => ({ ...row, vacancy: { ...row.vacancy, ...keys, ...patch } })) } }).success).toBe(false);
  });
});
