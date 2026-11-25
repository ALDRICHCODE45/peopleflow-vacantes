import { describe, expect, it } from "vitest";
import { addDays, describeRange, mxToday, presetRange, rangeKeyOf, shortDay } from "./date-range";

describe("Mexico City days", () => {
  it("reads today in America/Mexico_City, not in UTC", () => {
    expect(mxToday(new Date("2026-11-25T03:30:00Z"))).toBe("2026-11-24");
    expect(mxToday(new Date("2026-11-25T05:59:00Z"))).toBe("2026-11-24");
    expect(mxToday(new Date("2026-11-25T06:00:00Z"))).toBe("2026-11-25");
  });

  it("adds calendar days across month and year ends", () => {
    expect(addDays("2026-11-24", -29)).toBe("2026-10-26");
    expect(addDays("2026-01-02", -3)).toBe("2025-12-30");
  });

  it("builds Hoy / 7 días / 30 días ending today, both ends included", () => {
    expect(presetRange("today", "2026-11-24")).toEqual({ from: "2026-11-24", to: "2026-11-24" });
    expect(presetRange("7", "2026-11-24")).toEqual({ from: "2026-11-18", to: "2026-11-24" });
    expect(presetRange("30", "2026-11-24")).toEqual({ from: "2026-10-26", to: "2026-11-24" });
  });

  it("names the preset a from/to pair matches, «custom» for any other range and null for none", () => {
    expect(rangeKeyOf({ from: "2026-11-24", to: "2026-11-24" }, "2026-11-24")).toBe("today");
    expect(rangeKeyOf({ from: "2026-11-18", to: "2026-11-24" }, "2026-11-24")).toBe("7");
    expect(rangeKeyOf({ from: "2026-10-26", to: "2026-11-24" }, "2026-11-24")).toBe("30");
    expect(rangeKeyOf({ from: "2026-11-01", to: "2026-11-15" }, "2026-11-24")).toBe("custom");
    expect(rangeKeyOf({ from: "2026-11-01" }, "2026-11-24")).toBe("custom");
    expect(rangeKeyOf({}, "2026-11-24")).toBeNull();
  });

  it("describes a range in words, open-ended ones included", () => {
    expect(describeRange({ from: "2026-11-24", to: "2026-11-24" }, "2026-11-24")).toBe("Hoy (24 de noviembre de 2026)");
    expect(describeRange({ from: "2026-11-18", to: "2026-11-24" }, "2026-11-24")).toBe("Últimos 7 días (18 de noviembre de 2026 – 24 de noviembre de 2026)");
    expect(describeRange({ from: "2026-11-01", to: "2026-11-15" }, "2026-11-24")).toBe("Del 1 de noviembre de 2026 al 15 de noviembre de 2026");
    expect(describeRange({ from: "2026-11-01" }, "2026-11-24")).toBe("Desde el 1 de noviembre de 2026");
    expect(describeRange({ to: "2026-11-15" }, "2026-11-24")).toBe("Hasta el 15 de noviembre de 2026");
  });
});

describe("short days (artboard «26 oct 2026»)", () => {
  it("names a civil day with the three-letter month, «sep» included, and no leading zero", () => {
    expect(shortDay("2026-10-26")).toBe("26 oct 2026");
    expect(shortDay("2026-09-03")).toBe("3 sep 2026");
    expect(shortDay("2027-01-01")).toBe("1 ene 2027");
    expect(shortDay("2026-12-31")).toBe("31 dic 2026");
  });

  it("describes a range with the short names when asked, and keeps the long ones by default", () => {
    expect(describeRange({ from: "2026-10-26", to: "2026-11-24" }, "2026-11-24", shortDay)).toBe("Últimos 30 días (26 oct 2026 – 24 nov 2026)");
    expect(describeRange({ from: "2026-11-24", to: "2026-11-24" }, "2026-11-24", shortDay)).toBe("Hoy (24 nov 2026)");
    expect(describeRange({ from: "2026-11-01", to: "2026-11-15" }, "2026-11-24", shortDay)).toBe("Del 1 nov 2026 al 15 nov 2026");
    expect(describeRange({ from: "2026-11-01" }, "2026-11-24", shortDay)).toBe("Desde el 1 nov 2026");
    expect(describeRange({ from: "2026-11-01", to: "2026-11-15" }, "2026-11-24")).toBe("Del 1 de noviembre de 2026 al 15 de noviembre de 2026");
  });
});
