import { describe, expect, it } from "vitest";
import { defaultPeriod, mexicoToday, periodIssues, shortcutPeriod } from "./period";
import { apiQuery, parseFilters, serializeFilters } from "./url-state";
import { clientId, marianaId } from "./test-fixtures";

describe("period", () => {
  it("takes today from Mexico City, not from the browser or UTC", () => {
    // 02:00 UTC on Nov 8 is still Nov 7 in Mexico City.
    expect(mexicoToday(new Date("2026-11-08T02:00:00Z"))).toBe("2026-11-07");
  });

  it("defaults to the last 90 days ending today, both included", () => {
    expect(defaultPeriod("2026-11-07")).toEqual({ from: "2026-08-10", to: "2026-11-07" });
    expect(shortcutPeriod("last_30", "2026-11-07")).toEqual({ from: "2026-10-09", to: "2026-11-07" });
    expect(shortcutPeriod("this_year", "2026-11-07")).toEqual({ from: "2026-01-01", to: "2026-11-07" });
  });

  it("allows up to 366 days and reports a longer or inverted period as field errors", () => {
    // M7: 366 days counting both ends, so to - from ≤ 365.
    expect(periodIssues({ from: "2025-11-01", to: "2026-11-01" })).toEqual([]);
    expect(periodIssues({ from: "2025-11-01", to: "2026-11-02" })).toEqual([{ field: "to", message: "El periodo puede abarcar hasta 366 días. Elegiste 367." }]);
    expect(periodIssues({ from: "2025-09-01", to: "2026-10-31" })).toEqual([{ field: "to", message: "El periodo puede abarcar hasta 366 días. Elegiste 426." }]);
    expect(periodIssues({ from: "2026-10-31", to: "2026-10-01" })).toEqual([{ field: "to", message: "«Hasta» debe ser igual o posterior a «Desde»." }]);
    expect(periodIssues({ from: "", to: "2026-02-30" })).toEqual([
      { field: "from", message: "Elige la fecha de inicio." }, { field: "to", message: "Elige una fecha válida." },
    ]);
  });
});

describe("filters in the URL", () => {
  it("round trips the contract filters", () => {
    const raw = `from=2026-08-01&to=2026-10-31&recruiter_id=${marianaId}&requester_kind=client&requester_id=${clientId}`;
    const filters = parseFilters(new URLSearchParams(raw));
    expect(filters).toEqual({ from: "2026-08-01", to: "2026-10-31", recruiter_id: marianaId, requester_kind: "client", requester_id: clientId });
    expect(serializeFilters(filters).toString()).toBe(raw);
  });

  it("M6: none alone is «sin solicitante», none with a kind is that kind «sin especificar», a real id never travels without its kind", () => {
    expect(parseFilters(new URLSearchParams("requester_id=none"))).toEqual({ requester_id: "none" });
    expect(parseFilters(new URLSearchParams("requester_id=none&requester_kind=client"))).toEqual({ requester_kind: "client", requester_id: "none" });
    expect(serializeFilters({ requester_kind: "internal_area", requester_id: "none" }).toString()).toBe("requester_kind=internal_area&requester_id=none");
    expect(parseFilters(new URLSearchParams(`requester_id=${clientId}`))).toEqual({});
    expect(parseFilters(new URLSearchParams("requester_kind=internal_area"))).toEqual({ requester_kind: "internal_area" });
  });

  it("drops malformed values and unrelated parameters instead of forwarding them", () => {
    expect(parseFilters(new URLSearchParams("from=01-08-2026&to=2026-02-30&recruiter_id=nope&requester_kind=vendor&cursor=x&limit=500"))).toEqual({});
  });

  it("asks the API for the URL period, or the default one while the URL period is missing or invalid", () => {
    const today = "2026-11-07";
    expect(Object.fromEntries(apiQuery({ from: "2026-08-01", to: "2026-10-31", recruiter_id: marianaId }, today))).toEqual({ from: "2026-08-01", to: "2026-10-31", recruiter_id: marianaId });
    expect(Object.fromEntries(apiQuery({ requester_id: "none" }, today))).toEqual({ from: "2026-08-10", to: "2026-11-07", requester_id: "none" });
    expect(Object.fromEntries(apiQuery({ from: "2024-01-01", to: "2026-10-31" }, today))).toEqual({ from: "2026-08-10", to: "2026-11-07" });
  });
});
