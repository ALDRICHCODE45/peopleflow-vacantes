import { describe, expect, it } from "vitest";
import { DETAIL_PATH, drilldownHref, type Drilldown } from "./drilldown";

const period = { from: "2026-08-01", to: "2026-10-31" };
const late: Drilldown = { kind: "deliveries", params: { result: "late" } };

describe("drilldown links (rule 16: every figure opens its records)", () => {
  it("builds the detail URL from the figure's query, the period and the active filters", () => {
    const href = drilldownHref(late, { ...period, recruiter_id: "10000000-0000-4000-8000-000000000001" }, { enabled: true });
    const url = new URL(href!, "https://app.test");
    expect(url.pathname).toBe(DETAIL_PATH);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      kind: "deliveries", result: "late", from: "2026-08-01", to: "2026-10-31", recruiter_id: "10000000-0000-4000-8000-000000000001",
    });
  });

  it("lets the figure's own filter win over a board filter with the same name", () => {
    const href = drilldownHref({ kind: "deliveries", params: { recruiter_id: "10000000-0000-4000-8000-000000000002", result: "on_time,late,overdue" } },
      { ...period, recruiter_id: "10000000-0000-4000-8000-000000000001" }, { enabled: true });
    expect(new URL(href!, "https://app.test").searchParams.get("recruiter_id")).toBe("10000000-0000-4000-8000-000000000002");
  });

  it("opens a previous value with the previous period instead of the board period", () => {
    const href = drilldownHref({ kind: "vacancies", params: { scope: "assigned" }, period: { from: "2026-05-02", to: "2026-07-31" } }, period, { enabled: true });
    const params = new URL(href!, "https://app.test").searchParams;
    expect([params.get("from"), params.get("to"), params.get("scope")]).toEqual(["2026-05-02", "2026-07-31", "assigned"]);
  });

  it("is not a link for a 0 figure, and links by default now that the detail page ships", () => {
    expect(drilldownHref(late, period, { enabled: true, count: 0 })).toBeNull();
    expect(drilldownHref(late, period, { enabled: true, count: 3 })).not.toBeNull();
    expect(drilldownHref(late, period)).not.toBeNull();
    expect(drilldownHref(late, period, { enabled: false })).toBeNull();
  });
});
