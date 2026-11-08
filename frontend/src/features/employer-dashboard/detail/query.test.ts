import { describe, expect, it } from "vitest";
import { DASHBOARD_DETAIL_PATH } from "../drilldown";
import { boardHref, dashboardApiQuery, detailHref, parseDashboardDetail, withParams } from "./query";

const vacancy = "30000000-0000-4000-8000-000000000001";
const parse = (search: string) => parseDashboardDetail(new URLSearchParams(search));

describe("dashboard detail query (contract §5)", () => {
  it("needs a known kind", () => {
    expect(parse("window=30")).toBeNull();
    expect(parse("kind=placements&window=30")).toBeNull();
    expect(parse("kind=..%2Fsummary")).toBeNull();
  });

  it("keeps the window it receives and falls back to 30 only when it is missing or invalid", () => {
    expect(parse("kind=deliveries&window=90")?.window).toBe(90);
    expect(parse("kind=deliveries&window=7")?.window).toBe(7);
    expect(parse("kind=deliveries")?.window).toBe(30);
    expect(parse("kind=deliveries&window=14")?.window).toBe(30);
  });

  it("keeps each kind's own filters only, validated like the backend parser", () => {
    expect(parse(`kind=candidates&window=90&in_process=true&on=2026-08-12&stage_kind=screening,nope,screening&stalled=true&vacancy_id=${vacancy}&state=overdue&from=2026-01-01`)?.params)
      .toEqual({ in_process: "true", on: "2026-08-12", stage_kind: "screening", stalled: "true", vacancy_id: vacancy });
    expect(parse("kind=deliveries&state=overdue&status=published&stalled=true")?.params).toEqual({ state: "overdue" });
    expect(parse("kind=deliveries&state=late")?.params).toEqual({});
    expect(parse("kind=vacancies&status=published&sort=positions_open&state=overdue")?.params).toEqual({ status: "published", sort: "positions_open" });
    expect(parse("kind=vacancies&status=paused")?.params).toEqual({});
    expect(parse("kind=applications&from=2026-11-01&to=2026-11-02&channel=manual,portal&in_process=true")?.params)
      .toEqual({ from: "2026-11-01", to: "2026-11-02", channel: "manual,portal" });
  });

  it("drops what the backend would refuse: on without in_process, from after to, bad dates, ids and sorts", () => {
    expect(parse("kind=candidates&on=2026-08-12")?.params).toEqual({});
    expect(parse("kind=applications&from=2026-11-05&to=2026-11-01")?.params).toEqual({});
    expect(parse("kind=applications&from=2026-13-01")?.params).toEqual({});
    expect(parse("kind=deliveries&vacancy_id=nope&sort=hired_at&order=up")?.params).toEqual({});
    expect(parse("kind=deliveries&sort=business_days_overdue&order=asc")?.params).toEqual({ sort: "business_days_overdue", order: "asc" });
  });

  it("builds the page URL, the API query with the window, and the way back to the board", () => {
    const state = parse(`kind=candidates&window=90&in_process=true&vacancy_id=${vacancy}`)!;
    expect(detailHref(state)).toBe(`${DASHBOARD_DETAIL_PATH}?kind=candidates&window=90&in_process=true&vacancy_id=${vacancy}`);
    expect(Object.fromEntries(dashboardApiQuery(state))).toEqual({ window: "90", in_process: "true", vacancy_id: vacancy });
    expect(boardHref(state)).toBe("/empresa/dashboard?window=90");
  });

  it("patches a filter and validates again, keeping the window; removing in_process removes its day", () => {
    const state = parse("kind=candidates&window=7&in_process=true&on=2026-11-03")!;
    expect(withParams(state, { stage_kind: "screening" })).toEqual({ kind: "candidates", window: 7, params: { in_process: "true", on: "2026-11-03", stage_kind: "screening" } });
    expect(withParams(state, { in_process: undefined })).toEqual({ kind: "candidates", window: 7, params: {} });
    expect(withParams(state, { window: "90" }).window).toBe(7);
  });
});
