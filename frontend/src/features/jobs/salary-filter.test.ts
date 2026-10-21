import { describe, expect, it } from "vitest";
import { matchesSalaryFilter } from "./salary-filter";

const units = { salary_currency: "MXN", salary_period: "monthly", salary_basis: "gross" } as const;
const offer = (mode: "fixed" | "range", values: { amount?: string; min?: string; max?: string }, over: Partial<{ currency: "MXN" | "USD"; pay_period: "monthly" | "yearly"; basis: "gross" | "net" }> = {}) => ({
  mode, amount: values.amount ?? null, min: values.min ?? null, max: values.max ?? null,
  currency: "MXN", pay_period: "monthly", basis: "gross", ...over,
} as const);
const range = (min: string, max: string) => offer("range", { min, max });
const fixed = (amount: string) => offer("fixed", { amount });

describe("public salary filter matching (SAL-5..SAL-8)", () => {
  it("matches the rule example: 30–40k finds a 35–45k range and a fixed 38k", () => {
    const query = { ...units, salary_min: "30000", salary_max: "40000" };
    expect(matchesSalaryFilter(range("35000", "45000"), query)).toBe(true);
    expect(matchesSalaryFilter(fixed("38000"), query)).toBe(true);
    expect(matchesSalaryFilter(range("41000", "50000"), query)).toBe(false);
    expect(matchesSalaryFilter(fixed("29999.99"), query)).toBe(false);
  });
  it("treats both bounds as inclusive: fixed 40k and a 40–50k range match 30–40k", () => {
    const query = { ...units, salary_min: "30000", salary_max: "40000" };
    expect(matchesSalaryFilter(fixed("40000"), query)).toBe(true);
    expect(matchesSalaryFilter(range("40000", "50000"), query)).toBe(true);
    expect(matchesSalaryFilter(range("20000", "30000"), query)).toBe(true);
    expect(matchesSalaryFilter(fixed("40000.01"), query)).toBe(false);
  });
  it("«desde 30k» needs a maximum or fixed amount of 30k or more; «hasta 40k» a start of 40k or less", () => {
    const from = { ...units, salary_min: "30000" };
    expect(matchesSalaryFilter(range("20000", "30000"), from)).toBe(true);
    expect(matchesSalaryFilter(fixed("30000"), from)).toBe(true);
    expect(matchesSalaryFilter(range("10000", "29999"), from)).toBe(false);
    const upTo = { ...units, salary_max: "40000" };
    expect(matchesSalaryFilter(range("40000", "90000"), upTo)).toBe(true);
    expect(matchesSalaryFilter(fixed("40000"), upTo)).toBe(true);
    expect(matchesSalaryFilter(range("40001", "90000"), upTo)).toBe(false);
  });
  it("compares only when currency, pay period and basis all match, with no conversion", () => {
    const query = { ...units, salary_min: "30000", salary_max: "40000" };
    expect(matchesSalaryFilter(offer("fixed", { amount: "35000" }, { currency: "USD" }), query)).toBe(false);
    expect(matchesSalaryFilter(offer("fixed", { amount: "35000" }, { pay_period: "yearly" }), query)).toBe(false);
    expect(matchesSalaryFilter(offer("fixed", { amount: "35000" }, { basis: "net" }), query)).toBe(false);
  });
  it("excludes a vacancy without public salary only while a salary filter is active", () => {
    expect(matchesSalaryFilter(null, { ...units, salary_min: "1" })).toBe(false);
    expect(matchesSalaryFilter(null, {})).toBe(true);
    expect(matchesSalaryFilter(fixed("1"), {})).toBe(true);
  });
  it("compares amounts numerically, not as text", () => {
    expect(matchesSalaryFilter(fixed("9000"), { ...units, salary_min: "10000" })).toBe(false);
    expect(matchesSalaryFilter(fixed("100000"), { ...units, salary_max: "99999.5" })).toBe(false);
    expect(matchesSalaryFilter(fixed("40000.00"), { ...units, salary_min: "40000", salary_max: "40000" })).toBe(true);
  });
});
