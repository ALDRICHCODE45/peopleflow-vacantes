import { afterEach, expect, it, vi } from "vitest";
vi.mock("../api/listRelatedJobs", () => ({ listRelatedJobs: vi.fn() }));
import { listRelatedJobs } from "../api/listRelatedJobs";
import { vacancyDetail, listItem } from "../api/public-fixtures";
import { readSimilarVacancies } from "./read";

afterEach(() => vi.resetAllMocks());

it("S4 finds eligible vacancies beyond an excluded first page", async () => {
  const base = listItem(vacancyDetail);
  const own = Array.from({ length: 7 }, (_, i) => ({ ...base, id: `own-${i}` }));
  const other = { ...base, id: "other", company: { ...base.company, id: "another-company" } };
  vi.mocked(listRelatedJobs)
    .mockResolvedValueOnce({ ok: true, data: { items: own, next_cursor: "page2" } })
    .mockResolvedValueOnce({ ok: true, data: { items: [other], next_cursor: null } });
  expect(await readSimilarVacancies({ ...vacancyDetail, location: null })).toEqual({ ok: true, data: [other] });
  expect(vi.mocked(listRelatedJobs).mock.calls.map(([query]) => query)).toEqual([
    { professional_area: vacancyDetail.professional_area, limit: 7 },
    { professional_area: vacancyDetail.professional_area, limit: 7, cursor: "page2" },
  ]);
});

const other = (id: string) => ({ ...listItem(vacancyDetail), id, company: { ...vacancyDetail.company, id: "another-company" } });

it("caps each query at three pages and resets the cursor for area-only fill", async () => {
  vi.mocked(listRelatedJobs).mockResolvedValue({ ok: true, data: { items: [listItem(vacancyDetail)], next_cursor: "more" } });
  expect(await readSimilarVacancies(vacancyDetail)).toEqual({ ok: true, data: [] });
  const query = { professional_area: vacancyDetail.professional_area, limit: 7 };
  expect(vi.mocked(listRelatedJobs).mock.calls.map(([value]) => value)).toEqual([
    { ...query, state: "09" }, { ...query, state: "09", cursor: "more" }, { ...query, state: "09", cursor: "more" },
    query, { ...query, cursor: "more" }, { ...query, cursor: "more" },
  ]);
});

it.each([true, false])("stops paging as soon as three unique eligible results exist (state=%s)", withState => {
  vi.mocked(listRelatedJobs)
    .mockResolvedValueOnce({ ok: true, data: { items: [other("a")], next_cursor: "next" } })
    .mockResolvedValueOnce({ ok: true, data: { items: [other("a"), listItem(vacancyDetail), other("b"), other("c"), other("d")], next_cursor: "unused" } });
  return expect(readSimilarVacancies(withState ? vacancyDetail : { ...vacancyDetail, location: null })).resolves.toEqual({ ok: true, data: [other("a"), other("b"), other("c")] }).then(() => {
    expect(listRelatedJobs).toHaveBeenCalledTimes(2);
  });
});

it("preserves state priority across pages before area-only fill", async () => {
  vi.mocked(listRelatedJobs)
    .mockResolvedValueOnce({ ok: true, data: { items: [other("a")], next_cursor: "state2" } })
    .mockResolvedValueOnce({ ok: true, data: { items: [other("b")], next_cursor: null } })
    .mockResolvedValueOnce({ ok: true, data: { items: [other("a"), other("c")], next_cursor: "unused" } });
  expect(await readSimilarVacancies(vacancyDetail)).toEqual({ ok: true, data: [other("a"), other("b"), other("c")] });
  expect(listRelatedJobs).toHaveBeenCalledTimes(3);
});

it.each(["state", "area", "thrown"])("omits all similar results on a later %s page failure", async stage => {
  if (stage === "area") vi.mocked(listRelatedJobs).mockResolvedValueOnce({ ok: true, data: { items: [], next_cursor: null } });
  vi.mocked(listRelatedJobs).mockResolvedValueOnce({ ok: true, data: { items: [other("a")], next_cursor: "next" } });
  if (stage === "thrown") vi.mocked(listRelatedJobs).mockRejectedValueOnce(new Error("offline"));
  else vi.mocked(listRelatedJobs).mockResolvedValueOnce({ ok: false, error: { kind: "network", retryable: true } });
  expect(await readSimilarVacancies(vacancyDetail)).toEqual({ ok: false });
  expect(listRelatedJobs).toHaveBeenCalledTimes(stage === "area" ? 3 : 2);
});
