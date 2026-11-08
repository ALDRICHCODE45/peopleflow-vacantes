import { describe, expect, it } from "vitest";
import { DETAIL_PATH } from "../drilldown";
import { clientId, draftId, marianaId } from "../test-fixtures";
import { boardHref, detailApiQuery, detailHref, parseDetail, withParams } from "./query";

const parse = (search: string) => parseDetail(new URLSearchParams(search));
const period = "from=2026-08-01&to=2026-10-31";

describe("detail query (the board's drill-down URL, validated per kind)", () => {
  it("reads the kind, the board filters and the kind's own filters, in the API's names", () => {
    expect(parse(`kind=deliveries&${period}&recruiter_id=${marianaId}&result=late&late_bucket=from_3_to_5&commitment_month=2026-09&attributed_to=${marianaId}&sort=business_days_late&order=asc`)).toEqual({
      kind: "deliveries",
      params: {
        from: "2026-08-01", to: "2026-10-31", recruiter_id: marianaId, result: "late", late_bucket: "from_3_to_5",
        commitment_month: "2026-09", attributed_to: marianaId, sort: "business_days_late", order: "asc",
      },
    });
  });

  it("is null without a known kind, and accepts the kinds that arrive later", () => {
    expect(parse(period)).toBeNull();
    expect(parse(`kind=secrets&${period}`)).toBeNull();
    expect(parse("kind=candidates")).toEqual({ kind: "candidates", params: {} });
    expect(parse("kind=applications&channel=portal")).toEqual({ kind: "applications", params: {} });
  });

  it("drops unknown params, another kind's filters and malformed values instead of sending a guaranteed 422", () => {
    expect(parse(`kind=vacancies&${period}&result=late&held=true&scope=everything&close_reason=filled&closed_month=2026-13&credited_to=nope&sort=hired_at&order=up&token=x`)).toEqual({
      kind: "vacancies", params: { from: "2026-08-01", to: "2026-10-31", close_reason: "filled" },
    });
    expect(parse(`kind=placements&held=yes&recipient=${marianaId}&sort=candidate`)).toEqual({ kind: "placements", params: { recipient: marianaId, sort: "candidate" } });
    expect(parse(`kind=placements&held=false`)?.params).toEqual({ held: "false" });
  });

  it("dedupes repeated values in a multi-value filter and keeps only enum values", () => {
    expect(parse("kind=deliveries&result=late,late,on_time,soon")?.params).toEqual({ result: "late,on_time" });
    expect(parse("kind=deliveries&result=late&result=overdue")?.params).toEqual({ result: "late,overdue" });
    expect(parse("kind=reassignments&reason=,other,other")?.params).toEqual({ reason: "other" });
    expect(parse("kind=deliveries&result=,")?.params).toEqual({});
    expect(parse("kind=deliveries&late_bucket=over_5&late_bucket=up_to_2")?.params).toEqual({ late_bucket: "over_5" });
  });

  it("drops a direction without a recruiter, a requester id without its kind, an invalid period and a malformed vacancy", () => {
    expect(parse("kind=reassignments&direction=lost")?.params).toEqual({});
    expect(parse(`kind=reassignments&direction=lost&recruiter_id=${marianaId}`)?.params).toEqual({ recruiter_id: marianaId, direction: "lost" });
    expect(parse(`kind=deliveries&requester_id=${clientId}`)?.params).toEqual({});
    expect(parse(`kind=deliveries&requester_kind=client&requester_id=${clientId}`)?.params).toEqual({ requester_kind: "client", requester_id: clientId });
    expect(parse("kind=deliveries&requester_id=none")?.params).toEqual({ requester_id: "none" });
    expect(parse("kind=deliveries&from=2026-10-31&to=2026-08-01")?.params).toEqual({});
    expect(parse("kind=deliveries&from=2026-08-01")?.params).toEqual({});
    expect(parse("kind=deliveries&vacancy_id=../x")?.params).toEqual({});
    expect(parse(`kind=deliveries&vacancy_id=${draftId}`)?.params).toEqual({ vacancy_id: draftId });
  });

  it("sends the applied period: the URL one when valid, else the default 90 days in Mexico City", () => {
    const state = parse(`kind=deliveries&result=late&recruiter_id=${marianaId}`)!;
    expect(detailApiQuery(state, "2026-11-07").toString()).toBe(`from=2026-08-10&to=2026-11-07&recruiter_id=${marianaId}&result=late`);
    expect(detailApiQuery(parse(`kind=deliveries&${period}`)!, "2026-11-07").toString()).toBe(period);
  });

  it("rewrites one filter and links back to the board with only the board filters", () => {
    const state = parse(`kind=deliveries&${period}&recruiter_id=${marianaId}&result=late&sort=title`)!;
    expect(detailHref(withParams(state, { result: "on_time" }))).toBe(`${DETAIL_PATH}?kind=deliveries&${period}&recruiter_id=${marianaId}&result=on_time&sort=title`);
    expect(detailHref(withParams(state, { result: undefined }))).toBe(`${DETAIL_PATH}?kind=deliveries&${period}&recruiter_id=${marianaId}&sort=title`);
    expect(withParams(state, { result: "late,late" }).params.result).toBe("late");
    expect(boardHref(state)).toBe(`/empresa/metricas?${period}&recruiter_id=${marianaId}`);
    expect(boardHref(parse("kind=deliveries&result=late")!)).toBe("/empresa/metricas");
  });
});
