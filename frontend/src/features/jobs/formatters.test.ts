import { describe, expect, it } from "vitest";
import {
  employmentTypeLabel,
  formatClosingDate,
  formatPublishedDate,
  formatSalary,
  formatPublicCompensation,
  formatPublicSalary,
  formatPublicSalaryParts,
  payFrequencyLabel,
  seniorityLabel,
  workModeLabel,
} from "./formatters";

import { legacyDetail, vacancyDetail } from "./api/public-fixtures";

describe("public v2 salary formatting", () => {
  it("separates grouped amounts, currency and the existing cadence/basis without rounding decimal strings", () => {
    expect(formatPublicSalaryParts(vacancyDetail)).toEqual({ amount: "$30,000 – $40,000", currency: "MXN", cadence: "Mensual · Bruto" });
    expect(formatPublicSalaryParts({ ...vacancyDetail, compensation: { mode: "fixed", amount: "999999999999.99", min: null, max: null, currency: "USD", pay_period: "semimonthly", basis: "net" } })).toEqual({ amount: "$999,999,999,999.99", currency: "USD", cadence: "Quincenal · Neto" });
    expect(formatPublicSalaryParts({ ...vacancyDetail, compensation: { ...vacancyDetail.compensation, min: "0.10", max: "1.01" } })).toEqual({ amount: "$0.10 – $1.01", currency: "MXN", cadence: "Mensual · Bruto" });
    expect(formatPublicSalaryParts({ ...vacancyDetail, compensation: null })).toBeNull();
  });
  it("retains Desde/Hasta qualifiers and no invented cadence for legacy salary parts", () => {
    expect(formatPublicSalaryParts(legacyDetail)).toEqual({ amount: "$30,000 – $45,000", currency: "MXN", cadence: null });
    expect(formatPublicSalaryParts({ ...legacyDetail, legacy_salary: { min: "3000", max: null, currency: "USD" } })).toEqual({ amount: "Desde $3,000", currency: "USD", cadence: null });
    expect(formatPublicSalaryParts({ ...legacyDetail, legacy_salary: { min: null, max: "3000", currency: "USD" } })).toEqual({ amount: "Hasta $3,000", currency: "USD", cadence: null });
    expect(formatPublicSalaryParts({ ...legacyDetail, legacy_salary: null })).toBeNull();
  });
  it("uses exact decimal strings and shared draft cadence/basis labels", () => {
    expect(formatPublicCompensation(vacancyDetail.compensation)).toBe("30000.00 – 40000.00 MXN · Mensual · Bruto");
    expect(formatPublicCompensation({ mode: "fixed", amount: "999999999999.99", min: null, max: null, currency: "USD", pay_period: "semimonthly", basis: "net" })).toBe("999999999999.99 USD · Quincenal · Neto");
    expect(formatPublicCompensation({ mode: "fixed", amount: "0", min: null, max: null, currency: "MXN", pay_period: "hourly", basis: "gross" })).toBe("0.00 MXN · Por hora · Bruto");
  });
  it("omits hidden vacancy money and never invents a legacy period or basis", () => {
    expect(formatPublicSalary({ ...vacancyDetail, compensation: null })).toBeNull();
    expect(formatPublicSalary({ ...legacyDetail, legacy_salary: null })).toBeNull();
    expect(formatPublicSalary({ ...legacyDetail, legacy_salary: { min: "3000", max: null, currency: "USD" } })).toBe("Desde USD 3,000");
    expect(formatPublicSalary({ ...legacyDetail, legacy_salary: { min: null, max: "3000", currency: "USD" } })).toBe("Hasta USD 3,000");
    expect(formatPublicSalary(legacyDetail)).not.toMatch(/Mensual|Bruto|Neto/);
  });
});

describe("jobs es-MX formatters", () => {
  it("maps every backend enum wire value to a fixed Mexico Spanish label", () => {
    expect(workModeLabel("onsite")).toBe("Presencial");
    expect(workModeLabel("remote")).toBe("Remoto");
    expect(workModeLabel("hybrid")).toBe("Híbrido");
    expect(employmentTypeLabel("full_time")).toBe("Tiempo completo");
    expect(employmentTypeLabel("part_time")).toBe("Medio tiempo");
    expect(employmentTypeLabel("contract")).toBe("Por contrato");
    expect(employmentTypeLabel("internship")).toBe("Beca");
    expect(seniorityLabel("intern")).toBe("Prácticas");
    expect(seniorityLabel("junior")).toBe("Junior");
    expect(seniorityLabel("mid")).toBe("Medio");
    expect(seniorityLabel("senior")).toBe("Senior");
    expect(seniorityLabel("lead")).toBe("Líder");
  });

  it("formats publication dates deterministically in long es-MX UTC form", () => {
    expect(formatPublishedDate("2026-01-15T12:00:00Z")).toBe(
      "15 de enero de 2026",
    );
    // Deterministic regardless of the source offset: rendered in UTC.
    expect(formatPublishedDate("2026-01-15T06:00:00-06:00")).toBe(
      "15 de enero de 2026",
    );
    // Explicit offsets crossing the UTC calendar boundary prove the UTC rendering:
    expect(formatPublishedDate("2026-01-15T23:30:00-06:00")).toBe(
      "16 de enero de 2026",
    );
    expect(formatPublishedDate("2026-01-15T02:30:00+05:00")).toBe(
      "14 de enero de 2026",
    );
  });

  it("maps every prototype pay frequency to a fixed Mexico Spanish label", () => {
    expect(payFrequencyLabel("monthly")).toBe("Mensual");
    expect(payFrequencyLabel("yearly")).toBe("Anual");
    expect(payFrequencyLabel("hourly")).toBe("Por hora");
  });

  it("formats prototype closing dates deterministically in long es-MX UTC form", () => {
    expect(formatClosingDate("2026-03-31")).toBe("31 de marzo de 2026");
    // Explicit offsets crossing the UTC calendar boundary prove the UTC rendering:
    expect(formatClosingDate("2026-03-31T23:30:00-06:00")).toBe(
      "1 de abril de 2026",
    );
    expect(formatClosingDate("2026-03-31T02:30:00+05:00")).toBe(
      "30 de marzo de 2026",
    );
  });

  it("formats salary with the exact MXN|USD code and never invents a period", () => {
    expect(formatSalary({ min: 25000, max: 40000, currency: "MXN" })).toBe(
      "MXN 25,000 – MXN 40,000",
    );
    expect(formatSalary({ min: 3000, currency: "USD" })).toBe(
      "Desde USD 3,000",
    );
    expect(formatSalary({ max: 3000, currency: "USD" })).toBe(
      "Hasta USD 3,000",
    );
    expect(formatSalary({ currency: "MXN" })).toBeNull();
    expect(
      formatSalary({ min: 25000, max: 40000, currency: "MXN" }),
    ).not.toContain("por mes");
  });
});
