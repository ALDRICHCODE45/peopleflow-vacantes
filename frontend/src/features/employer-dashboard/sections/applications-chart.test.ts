import { describe, expect, it } from "vitest";
import { chartPoints, yScale } from "./applications-chart";
import { origin } from "../test-fixtures";

/** Recharts draws no SVG under jsdom, so the axis is checked through the scale the chart hands to its YAxis. */
describe("applications chart y-axis", () => {
  it("fits a 7-day average with decimal ticks instead of squashing it under whole ones", () => {
    const days = origin(30).by_day.map((day, index) => ({ ...day, organic: index >= 20 && index < 24 ? 3 : 0, manual: 0 }));
    // Max average = 12 / 7 ≈ 1.7: the axis ends at 2, not 4.
    expect(yScale(chartPoints(days, true), true)).toEqual({ domain: [0, 2], ticks: [0, 0.5, 1, 1.5, 2], allowDecimals: true });
  });

  it("keeps whole ticks for raw daily counts, fitted to the largest", () => {
    const days = origin(7).by_day;
    expect(yScale(chartPoints(days.map(day => ({ ...day, organic: 1, manual: 0 })), false), false)).toEqual({ domain: [0, 1], ticks: [0, 1], allowDecimals: false });
    expect(yScale(chartPoints(days.map((day, index) => ({ ...day, organic: index === 3 ? 13 : 2, manual: 1 })), false), false)).toEqual({ domain: [0, 15], ticks: [0, 5, 10, 15], allowDecimals: false });
    expect(yScale(chartPoints(days.map(day => ({ ...day, organic: 3, manual: 0 })), false), false)).toEqual({ domain: [0, 3], ticks: [0, 1, 2, 3], allowDecimals: false });
  });

  it("fits a larger average with its own step", () => {
    const days = origin(30).by_day.map(day => ({ ...day, organic: 9, manual: 0 }));
    expect(yScale(chartPoints(days, true), true)).toEqual({ domain: [0, 10], ticks: [0, 2.5, 5, 7.5, 10], allowDecimals: true });
  });
});
