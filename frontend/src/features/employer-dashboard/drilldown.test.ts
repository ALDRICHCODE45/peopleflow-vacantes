import { describe, expect, it } from "vitest";
import { DASHBOARD_DETAIL_ENABLED, DASHBOARD_DETAIL_PATH, dashboardDrillHref, dashboardListPath, drillFor } from "./drilldown";

const query = (href: string | null) => Object.fromEntries(new URL(href!, "https://app.test").searchParams);

describe("dashboard drill-down (contract §5)", () => {
  it("is on: the d2b lists have their page (T14), so every figure opens its records by default", () => {
    expect(DASHBOARD_DETAIL_ENABLED).toBe(true);
    expect(query(dashboardDrillHref({ kind: "candidates", params: { in_process: "true" } }, 30, { count: 5 }))).toEqual({ kind: "candidates", window: "30", in_process: "true" });
    expect(query(drillFor(7)({ kind: "deliveries", params: { state: "overdue" } }, 2))).toEqual({ kind: "deliveries", window: "7", state: "overdue" });
    // The switch still turns every figure back into plain text.
    expect(dashboardDrillHref({ kind: "candidates", params: { in_process: "true" } }, 30, { enabled: false, count: 5 })).toBeNull();
  });

  it("builds the list query with the window and the figure's own filter", () => {
    const href = dashboardDrillHref({ kind: "deliveries", params: { state: "overdue" } }, 90, { enabled: true, count: 6 });
    expect(href?.startsWith(`${DASHBOARD_DETAIL_PATH}?`)).toBe(true);
    expect(query(href)).toEqual({ kind: "deliveries", window: "90", state: "overdue" });
    expect(query(dashboardDrillHref({ kind: "candidates", params: { vacancy_id: "v", in_process: "true" } }, 7, { enabled: true })))
      .toEqual({ kind: "candidates", window: "7", vacancy_id: "v", in_process: "true" });
    expect(query(dashboardDrillHref({ kind: "applications", params: { from: "2026-11-01", to: "2026-11-01", channel: "manual" } }, 30, { enabled: true })))
      .toEqual({ kind: "applications", window: "30", from: "2026-11-01", to: "2026-11-01", channel: "manual" });
  });

  it("opens the talent base for «Nuevos en la base» with the added dates", () => {
    const href = dashboardDrillHref({ kind: "talent_base", params: { added_from: "2026-10-10", added_to: "2026-11-08" } }, 30, { enabled: true, count: 3 });
    expect(href).toBe("/empresa/talento?added_from=2026-10-10&added_to=2026-11-08");
  });

  it("carries the section's window on every list target, so on/from/to validate against it (d2b 422 otherwise)", () => {
    const drill = drillFor(90, true);
    expect(query(drill({ kind: "candidates", params: { in_process: "true", on: "2026-08-12" } }))).toEqual({ kind: "candidates", window: "90", in_process: "true", on: "2026-08-12" });
    expect(query(drill({ kind: "applications", params: { from: "2026-08-11", to: "2026-08-11" } }))).toMatchObject({ window: "90" });
    for (const kind of ["candidates", "deliveries", "vacancies", "applications"] as const) {
      for (const window of [7, 30, 90] as const) expect(query(drillFor(window, true)({ kind, params: {} }, 3)).window).toBe(String(window));
    }
    // A figure's own params never override the section window.
    expect(query(drill({ kind: "deliveries", params: { window: "30", state: "overdue" } })).window).toBe("90");
  });

  it("names the d2b list route of each kind", () => {
    expect(["candidates", "deliveries", "vacancies", "applications"].map(kind => dashboardListPath(kind as never))).toEqual([
      "/v2/me/company/dashboard/lists/candidates", "/v2/me/company/dashboard/lists/deliveries",
      "/v2/me/company/dashboard/lists/vacancies", "/v2/me/company/dashboard/lists/applications",
    ]);
  });

  it("never links a 0", () => { expect(dashboardDrillHref({ kind: "vacancies", params: { status: "published" } }, 30, { enabled: true, count: 0 })).toBeNull(); });
});
