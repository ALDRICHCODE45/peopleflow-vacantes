import { describe, expect, it } from "vitest";
import {
  employmentTypeLabel,
  formatClosingDate,
  formatPublishedDate,
  formatSalary,
  payFrequencyLabel,
  seniorityLabel,
  workModeLabel,
} from "./formatters";

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
