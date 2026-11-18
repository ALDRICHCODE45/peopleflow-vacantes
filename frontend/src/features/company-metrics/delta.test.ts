import { describe, expect, it } from "vitest";
import { countDelta, rateDelta } from "./delta";

describe("headline deltas (N1)", () => {
  it("states a count change with its sign and whether it is good", () => {
    expect(countDelta({ current: 42, previous: 38 })).toEqual({ label: "+4", direction: "up", tone: "positive", accessible: "4 más que el periodo anterior" });
    expect(countDelta({ current: 6, previous: 9 }, "down")).toEqual({ label: "−3", direction: "down", tone: "positive", accessible: "3 menos que el periodo anterior" });
    expect(countDelta({ current: 19, previous: 25 })).toMatchObject({ label: "−6", tone: "negative" });
    expect(countDelta({ current: 5, previous: 5 })).toEqual({ label: "Sin cambio", direction: "flat", tone: "neutral", accessible: "Igual que el periodo anterior" });
  });

  it("has no delta when either side has no sample", () => {
    expect(countDelta({ current: 23, previous: null }, "down")).toBeNull();
    expect(countDelta({ current: null, previous: 27 }, "down")).toBeNull();
  });

  it("compares rates in percentage points from their rounded values", () => {
    expect(rateDelta({ current: { value: 0.7778, numerator: 98, denominator: 126 }, previous: { value: 0.7, numerator: 70, denominator: 100 } }))
      .toEqual({ label: "+8 pts", direction: "up", tone: "positive", accessible: "8 puntos más que el periodo anterior" });
    expect(rateDelta({ current: { value: 0.5, numerator: 1, denominator: 2 }, previous: { value: null, numerator: 0, denominator: 0 } })).toBeNull();
    expect(rateDelta({ current: { value: 0.701, numerator: 701, denominator: 1000 }, previous: { value: 0.7, numerator: 7, denominator: 10 } })).toMatchObject({ label: "Sin cambio", tone: "neutral" });
  });
});
