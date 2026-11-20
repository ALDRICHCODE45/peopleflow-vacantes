import { describe, expect, it } from "vitest";
import { boardPath, DETAIL_PATH, drilldownHref, recruiterPath, safeBoardPath, type Drilldown } from "./drilldown";

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

  it("carries an explicit «back» (a recruiter page) instead of the board when the figure is opened from there", () => {
    const back = recruiterPath("10000000-0000-4000-8000-000000000001", period);
    expect(back).toBe("/empresa/metricas/reclutadores/10000000-0000-4000-8000-000000000001?from=2026-08-01&to=2026-10-31");
    const href = drilldownHref({ kind: "placements", params: { recipient: "10000000-0000-4000-8000-000000000001" } }, period, { back });
    expect(new URL(href!, "https://app.test").searchParams.get("back")).toBe(back);
  });
});

describe("process_kind in drill-down links", () => {
  const id = "10000000-0000-4000-8000-000000000001";
  it("carries the process filter into every figure's detail URL and back path", () => {
    const filters = { from: "2026-08-01", to: "2026-10-31", process_kind: "replacement" } as const;
    const href = new URL(drilldownHref({ kind: "placements", params: {} }, filters, { enabled: true })!, "https://app.test");
    expect(href.searchParams.get("process_kind")).toBe("replacement");
    expect(href.searchParams.get("back")).toBe("/empresa/metricas?from=2026-08-01&to=2026-10-31&process_kind=replacement");
    expect(boardPath(filters)).toBe("/empresa/metricas?from=2026-08-01&to=2026-10-31&process_kind=replacement");
  });

  it("keeps the process filter on a recruiter page link and on a validated back path", () => {
    const scope = { from: "2026-08-01", to: "2026-10-31", process_kind: "original" } as const;
    expect(recruiterPath(id, scope)).toBe(`/empresa/metricas/reclutadores/${id}?from=2026-08-01&to=2026-10-31&process_kind=original`);
    expect(safeBoardPath(`/empresa/metricas/reclutadores/${id}?from=2026-08-01&to=2026-10-31&process_kind=original&recruiter_id=${id}`))
      .toBe(`/empresa/metricas/reclutadores/${id}?from=2026-08-01&to=2026-10-31&process_kind=original`);
    expect(safeBoardPath("/empresa/metricas?process_kind=replacement")).toBe("/empresa/metricas?process_kind=replacement");
    expect(safeBoardPath("/empresa/metricas?process_kind=nope")).toBe("/empresa/metricas");
  });
});

describe("back to the board (only a same-origin /empresa/metricas path)", () => {
  it("keeps the board path with its filters, normalized", () => {
    expect(safeBoardPath("/empresa/metricas?from=2026-08-01&to=2026-10-31")).toBe("/empresa/metricas?from=2026-08-01&to=2026-10-31");
    expect(safeBoardPath("/empresa/metricas")).toBe("/empresa/metricas");
    expect(safeBoardPath("/empresa/metricas?recruiter_id=nope&from=2026-08-01&token=x")).toBe("/empresa/metricas?from=2026-08-01");
  });

  it("accepts exactly a recruiter page under Métricas, keeping only its window", () => {
    const id = "10000000-0000-4000-8000-000000000001";
    expect(safeBoardPath(`/empresa/metricas/reclutadores/${id}?from=2026-08-01&to=2026-10-31`)).toBe(`/empresa/metricas/reclutadores/${id}?from=2026-08-01&to=2026-10-31`);
    expect(safeBoardPath(`/empresa/metricas/reclutadores/${id}`)).toBe(`/empresa/metricas/reclutadores/${id}`);
    expect(safeBoardPath(`/empresa/metricas/reclutadores/${id}?to=2026-10-31&recruiter_id=${id}&requester_id=none&from=2026-08-01&token=x#frag`))
      .toBe(`/empresa/metricas/reclutadores/${id}?from=2026-08-01&to=2026-10-31`);
    expect(safeBoardPath(`/empresa/metricas/reclutadores/${id}?from=nope`)).toBe(`/empresa/metricas/reclutadores/${id}`);
  });

  it("rejects every other recruiter-like path", () => {
    const id = "10000000-0000-4000-8000-000000000001";
    for (const value of ["/empresa/metricas/reclutadores", "/empresa/metricas/reclutadores/", "/empresa/metricas/reclutadores/not-a-uuid",
      `/empresa/metricas/reclutadores/${id}/extra`, `/empresa/metricas/reclutadores/${id}/`, `/empresa/metricas/reclutadores/${id}x`,
      `/empresa/metricas/reclutadores/${id}/../../../vacantes`, `/empresa/metricas/reclutadores/%2e%2e/${id}`, `/empresa/metricas/reclutadores/${id}%2Fextra`,
      `https://evil.test/empresa/metricas/reclutadores/${id}`, `//evil.test/empresa/metricas/reclutadores/${id}`, `/empresa/metricas/reclutadoresx/${id}`,
      `/empresa/metricas/detalle/reclutadores/${id}`, `/empresa/metricas/reclutadores\\${id}`]) {
      expect(safeBoardPath(value), value).toBeNull();
    }
  });

  it("rejects anything else: other origins, protocol-relative, other paths, the detail page, scripts", () => {
    for (const value of [null, "", "https://evil.test/empresa/metricas", "//evil.test/empresa/metricas", "/empresa/metricas/detalle?kind=deliveries",
      "/empresa/metricasx", "/empresa/vacantes", "javascript:alert(1)", "empresa/metricas", "/\\evil.test/empresa/metricas", "/empresa/metricas/../vacantes"]) {
      expect(safeBoardPath(value)).toBeNull();
    }
  });
});
