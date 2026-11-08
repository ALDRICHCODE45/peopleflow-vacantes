import { describe, expect, it } from "vitest";
import { attentionSchema, originSchema, parseWindow, pipelineSchema, recentSchema, summarySchema, vacanciesSchema } from "./model";
import { attention, origin, pipeline, recent, recentRows, summary, vacancies } from "./test-fixtures";

describe("window", () => {
  it.each([["7", 7], ["30", 30], ["90", 90], [7, 7], [null, 30], [undefined, 30], ["", 30], ["14", 30], ["030", 30], ["7.0", 30], ["abc", 30]] as const)(
    "reads %s as %s (default 30, contract §2)", (raw, expected) => { expect(parseWindow(raw)).toBe(expected); });
});

describe("dashboard v2 decoders (contract §3)", () => {
  it.each([
    ["summary", summarySchema, summary()], ["summary 7", summarySchema, summary(7)], ["summary 90", summarySchema, summary(90)],
    ["attention", attentionSchema, attention()], ["pipeline", pipelineSchema, pipeline()], ["vacancies", vacanciesSchema, vacancies()],
    ["recent", recentSchema, recent()], ["origin", originSchema, origin()], ["origin 7", originSchema, origin(7)],
  ] as const)("accepts the exact %s response", (_name, schema, value) => { expect(schema.parse(value)).toEqual(value); });

  it("accepts pool_added null without talent-base access and the own-vacancies scope", () => {
    expect(summarySchema.parse({ ...summary(), pool_added: null, scope: "own_vacancies" })).toMatchObject({ pool_added: null, scope: "own_vacancies" });
  });

  it.each([
    ["extra field", { ...summary(), extra: true }],
    ["missing as_of", { ...summary(), as_of: undefined }],
    ["unknown scope", { ...summary(), scope: "everyone" }],
    ["unknown window", { ...summary(), window: { ...summary().window, days: 14 } }],
    ["negative count", { ...summary(), published_vacancies: { current: -1, previous: 0 } }],
    ["fractional count", { ...summary(), positions: { covered: 1.5, required: 3 } }],
    ["series one point short", { ...summary(), in_process: { ...summary().in_process, series: summary().in_process.series.slice(1) } }],
    ["series not ending on window.to", { ...summary(), in_process: { ...summary().in_process, series: summary().in_process.series.map(point => ({ ...point, date: point.date.replace("2026-11", "2026-12") })) } }],
  ] as const)("rejects a summary with %s", (_name, value) => { expect(summarySchema.safeParse(value).success).toBe(false); });

  it("rejects duplicate or out-of-order series and origin days", () => {
    const series = [...summary().in_process.series]; series[2] = series[1];
    expect(summarySchema.safeParse({ ...summary(), in_process: { ...summary().in_process, series } }).success).toBe(false);
    const days = [...origin().by_day]; days[3] = days[2];
    expect(originSchema.safeParse({ ...origin(), by_day: days }).success).toBe(false);
    expect(originSchema.safeParse({ ...origin(), by_day: origin().by_day.slice(1) }).success).toBe(false);
  });

  it.each([
    ["more than 5 rows", { ...attention(), overdue: { total: 9, top: Array(6).fill(attention().overdue.top[0]) } }],
    ["top longer than total", { ...attention(), stalled: { ...attention().stalled, total: 0 } }],
    ["overdue row without business days", { ...attention(), overdue: { total: 1, top: [{ ...attention().overdue.top[0], business_days_overdue: undefined }] } }],
    ["due row with business days", { ...attention(), due_this_week: { total: 1, top: [{ ...attention().due_this_week.top[0], business_days_overdue: 2 }] } }],
    ["unknown stage kind", { ...attention(), stalled: { ...attention().stalled, top: [{ ...attention().stalled.top[0], stage: { kind: "discarded", name: "x" } }] } }],
    ["impossible date", { ...attention(), overdue: { total: 1, top: [{ ...attention().overdue.top[0], commitment_date: "2026-02-30" }] } }],
  ] as const)("rejects attention with %s", (_name, value) => { expect(attentionSchema.safeParse(value).success).toBe(false); });

  it("rejects malformed recent rows and more than five", () => {
    expect(recentSchema.safeParse({ ...recent(), recent: Array(6).fill(recentRows[0]) }).success).toBe(false);
    expect(recentSchema.safeParse({ ...recent(), recent: [{ ...recentRows[0], source: "referral" }] }).success).toBe(false);
    expect(recentSchema.safeParse({ ...recent(), recent: [{ ...recentRows[0], added_by: recentRows[1].added_by }] }).success).toBe(false);
    expect(recentSchema.safeParse({ ...recent(), recent: [{ ...recentRows[1], added_by: null }] }).success).toBe(false);
  });

  it("rejects vacancy rows with extra fields and more than five", () => {
    expect(vacanciesSchema.safeParse({ ...vacancies(), top: [{ ...vacancies().top[0], extra: 1 }] }).success).toBe(false);
    expect(vacanciesSchema.safeParse({ ...vacancies(), top: Array(6).fill(vacancies().top[0]) }).success).toBe(false);
  });
});
