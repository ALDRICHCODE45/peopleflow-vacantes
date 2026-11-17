import { describe, expect, it } from "vitest";
import { boardPath, DETAIL_PATH, drilldownHref, safeBoardPath, type Drilldown } from "./drilldown";

const period = { from: "2026-08-01", to: "2026-10-31" };
const late: Drilldown = { kind: "deliveries", params: { result: "late" } };

describe("drilldown links (rule 16: every figure opens its records)", () => {
  it("builds the detail URL from the figure's query, the period and the active filters", () => {
    const href = drilldownHref(late, { ...period, recruiter_id: "10000000-0000-4000-8000-000000000001" }, { enabled: true });
    const url = new URL(href!, "https://app.test");
    expect(url.pathname).toBe(DETAIL_PATH);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      kind: "deliveries", result: "late", from: "2026-08-01", to: "2026-10-31", recruiter_id: "10000000-0000-4000-8000-000000000001",
      back: "/empresa/metricas?from=2026-08-01&to=2026-10-31&recruiter_id=10000000-0000-4000-8000-000000000001",
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

  it("carries the board it came from as «back», untouched by the figure's own recruiter or previous period", () => {
    const board = { ...period, requester_kind: "client" as const, requester_id: "none" };
    const recruiter = drilldownHref({ kind: "vacancies", params: { scope: "assigned", recruiter_id: "10000000-0000-4000-8000-000000000002" } }, board, { enabled: true });
    expect(new URL(recruiter!, "https://app.test").searchParams.get("back")).toBe("/empresa/metricas?from=2026-08-01&to=2026-10-31&requester_kind=client&requester_id=none");
    const previous = drilldownHref({ kind: "vacancies", params: { scope: "assigned" }, period: { from: "2026-05-02", to: "2026-07-31" } }, period, { enabled: true });
    expect(new URL(previous!, "https://app.test").searchParams.get("back")).toBe("/empresa/metricas?from=2026-08-01&to=2026-10-31");
    expect(boardPath({})).toBe("/empresa/metricas");
  });
});

describe("back to the board (only a same-origin /empresa/metricas path)", () => {
  it("keeps the board path with its filters, normalized", () => {
    expect(safeBoardPath("/empresa/metricas?from=2026-08-01&to=2026-10-31")).toBe("/empresa/metricas?from=2026-08-01&to=2026-10-31");
    expect(safeBoardPath("/empresa/metricas")).toBe("/empresa/metricas");
    expect(safeBoardPath("/empresa/metricas?recruiter_id=nope&from=2026-08-01&token=x")).toBe("/empresa/metricas?from=2026-08-01");
  });

  it("rejects anything else: other origins, protocol-relative, other paths, the detail page, scripts", () => {
    for (const value of [null, "", "https://evil.test/empresa/metricas", "//evil.test/empresa/metricas", "/empresa/metricas/detalle?kind=deliveries",
      "/empresa/metricasx", "/empresa/vacantes", "javascript:alert(1)", "empresa/metricas", "/\\evil.test/empresa/metricas", "/empresa/metricas/../vacantes"]) {
      expect(safeBoardPath(value)).toBeNull();
    }
  });
});
