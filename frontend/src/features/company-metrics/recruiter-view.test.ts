import { describe, expect, it } from "vitest";
import { safeBoardPath } from "./drilldown";
import { COLUMN_IDS, DEFAULT_VIEW, detailOrigin, isDefaultView, parseTableView, recruiterFromTable, serializeTableView, TABLE_PATH, tablePath, tableReturn } from "./recruiter-view";

const id = "10000000-0000-4000-8000-000000000001";
const requester = "20000000-0000-4000-8000-000000000001";
const params = (query: string) => new URLSearchParams(query);
const period = { from: "2026-08-01", to: "2026-10-31" };

describe("the table's own state in the URL (S2, S4)", () => {
  it("is the default view (by name, every column) when the URL says nothing", () => {
    expect(parseTableView(params(""))).toEqual(DEFAULT_VIEW);
    expect(isDefaultView(DEFAULT_VIEW)).toBe(true);
    expect(serializeTableView(DEFAULT_VIEW).toString()).toBe("");
  });

  it("reads the order and the hidden columns, and writes only what differs from the default, columns in table order", () => {
    const view = parseTableView(params("sort=on_time:descending&hide=median,assigned"));
    expect(view).toEqual({ sort: { key: "on_time", direction: "descending" }, hidden: ["assigned", "median"] });
    expect(isDefaultView(view)).toBe(false);
    expect(serializeTableView(view).toString()).toBe("sort=on_time%3Adescending&hide=assigned%2Cmedian");
    expect(serializeTableView({ ...DEFAULT_VIEW, hidden: ["conversion"] }).toString()).toBe("hide=conversion");
  });

  it("drops unknown orders and columns instead of trusting a hand-edited URL", () => {
    expect(parseTableView(params("sort=salary:ascending&hide=nope"))).toEqual(DEFAULT_VIEW);
    expect(parseTableView(params("sort=on_time:sideways"))).toEqual(DEFAULT_VIEW);
    expect(parseTableView(params("hide=median,median,name,constructor"))).toEqual({ ...DEFAULT_VIEW, hidden: ["median"] });
  });

  it("lists the eight columns in the order of the grouped table", () => {
    expect(COLUMN_IDS).toEqual(["assigned", "reassignments", "business_days", "on_time", "median", "delivered", "placements", "conversion"]);
  });

  it("builds the table path with period, filters, order and columns", () => {
    expect(TABLE_PATH).toBe("/empresa/metricas/reclutadores");
    expect(tablePath({})).toBe(TABLE_PATH);
    expect(tablePath({ ...period, process_kind: "replacement", recruiter_id: id, requester_kind: "client", requester_id: requester }, { sort: { key: "median", direction: "ascending" }, hidden: ["delivered"] }))
      .toBe(`${TABLE_PATH}?from=2026-08-01&to=2026-10-31&recruiter_id=${id}&requester_kind=client&requester_id=${requester}&process_kind=replacement&sort=median%3Aascending&hide=delivered`);
  });
});

describe("a row opens the recruiter detail remembering the table (S4)", () => {
  it("carries origin=table, the filters and the view; `from` stays the period start", () => {
    const href = recruiterFromTable(id, { ...period, process_kind: "original", recruiter_id: id }, { sort: { key: "on_time", direction: "descending" }, hidden: ["median"] });
    const url = new URL(href, "https://app.test");
    expect(url.pathname).toBe(`${TABLE_PATH}/${id}`);
    expect(Object.fromEntries(url.searchParams)).toEqual({ ...period, recruiter_id: id, process_kind: "original", sort: "on_time:descending", hide: "median", origin: "table" });
  });

  it("recognizes only the known origin", () => {
    expect(detailOrigin(params("origin=table"))).toBe("table");
    for (const query of ["", "origin=board", "origin=https://evil.test", "origin=Table", "origin=%2F%2Fevil.test", "origin=table,board"]) expect(detailOrigin(params(query)), query).toBeNull();
  });

  it("returns to the table with the period, the filters, the order and the columns it left", () => {
    const query = `from=2026-08-01&to=2026-10-31&process_kind=replacement&recruiter_id=${id}&sort=on_time%3Adescending&hide=median&origin=table`;
    expect(tableReturn(params(query), period)).toBe(`${TABLE_PATH}?from=2026-08-01&to=2026-10-31&recruiter_id=${id}&process_kind=replacement&sort=on_time%3Adescending&hide=median`);
  });

  it("uses the period the detail page shows, never an unvalidated one, and never echoes foreign values", () => {
    const back = tableReturn(params("from=nope&sort=drop:table&hide=x&origin=table&next=https://evil.test&redirect=//evil.test"), period);
    expect(back).toBe(`${TABLE_PATH}?from=2026-08-01&to=2026-10-31`);
    expect(back).not.toContain("evil");
  });
});

describe("the table as a «back» of a figure's detail page", () => {
  it("is accepted with its normalized filters and view, and nothing else", () => {
    expect(safeBoardPath(`${TABLE_PATH}?from=2026-08-01&to=2026-10-31&sort=on_time%3Adescending&hide=median&token=x&recruiter_id=nope`))
      .toBe(`${TABLE_PATH}?from=2026-08-01&to=2026-10-31&sort=on_time%3Adescending&hide=median`);
    expect(safeBoardPath(TABLE_PATH)).toBe(TABLE_PATH);
    for (const value of [`${TABLE_PATH}/`, `https://evil.test${TABLE_PATH}`, `//evil.test${TABLE_PATH}`, `${TABLE_PATH}x`, `${TABLE_PATH}\\x`]) expect(safeBoardPath(value), value).toBeNull();
  });

  it("keeps a recruiter page's table origin through a figure's detail page", () => {
    const here = recruiterFromTable(id, { ...period, recruiter_id: id }, { sort: { key: "median", direction: "ascending" }, hidden: ["delivered"] });
    expect(safeBoardPath(here)).toBe(here);
    expect(safeBoardPath(`/empresa/metricas/reclutadores/${id}?from=2026-08-01&origin=nope&sort=median%3Aascending`)).toBe(`/empresa/metricas/reclutadores/${id}?from=2026-08-01`);
  });
});
