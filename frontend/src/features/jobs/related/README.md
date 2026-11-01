# Detail exploration data (T1)

Import server reads from `./read`; import the pure chip helper from `./chips`.

```ts
readCompanyVacancies(job: PublicJobDetail): Promise<RelatedResult<PublicJobItem[]>>
readSimilarVacancies(job: PublicJobDetail): Promise<RelatedResult<PublicJobItem[]>>
readRelatedCompany(job: PublicJobDetail): Promise<RelatedResult<RelatedCompany>>
deriveRelatedSearches(job: RelatedSearchSource): RelatedSearchChip[]
```

`RelatedResult<T>` is `{ ok: true; data: T } | { ok: false }`. Omit a failed
section; empty job arrays also render no job section. Reads never propagate an
exception into the detail. Load the independent sections without awaiting them
before rendering the existing detail; loading UI belongs to T2.

Company vacancies request `company_id=<uuid>&limit=4`, remove the current id and
keep at most 3. Similar vacancies request `state=<INEGI code>&professional_area=<area>&limit=7`,
remove current/own-company jobs, then fill from the same area without state when
needed. IDs are deduplicated; state matches come first. Within each response the
catalog's relevance/publication order is retained. No area means no request;
no state means one area-only request. A failed fill omits the entire similar
section, not just the fill. These reads deliberately do not paginate.

Internal `api/listRelatedJobs.ts` owns `RelatedJobsQuery` and `listRelatedJobs`.
The public `JobsQuery`, `buildJobsUrl` and `listJobs` are unchanged. Sample mode
uses the existing ten fictional legacy rows offline; it does not invent areas,
profiles, counts or careers sites.

`RelatedSearchSource` picks `professional_area`, `location`, `work_mode` and
`seniority` from `PublicJobDetail`. Chips use the existing area/seniority labels
and expanded state name. Remote is
emitted only for a remote vacancy. Every chip href uses `buildJobsUrl`.

## Company contract gap for T2

The existing anonymous `getCompanyProfile(id)` read exposes name, logo and
description. Its decoder drops `industry_id` and `size`, and it exposes no
published careers-site slug. Consequently `RelatedCompany` includes nullable
`sector`, `size`, and `careersHref`, currently always null. Do not treat the
company's website as a published careers site, guess a slug from its name/id,
or derive vacancy counts from the returned sample. Completing these fields
requires a supported published-site locator and an expanded existing profile
projection outside T1's allowed edit surfaces.

With no description or published careers link, the UI renders only company
identity and its other vacancies; it omits the block when that list is also empty.
The public `/vacantes` URL grammar does not accept `company_id`; the fallback
“all company vacancies” fallback is intentionally omitted (parent decision L7),
never passed as a silently discarded filter to `buildJobsUrl`.

## Detail UI (T2)

`ui.tsx` composes the installed Card/Skeleton primitives and company avatar.
`ExploreDetail` takes the three read promises started by the route after its
existing request-scoped detail read. Independent Suspense boundaries show shaped
company and similar-vacancy skeletons without gating the detail. The company
card occupies the optional `belowContent` slot in the existing left column;
similar cards and canonical search links follow the complete detail grid.

An unsuccessful company profile omits its card; an unsuccessful vacancy list
omits its rows but preserves any published company description or careers link.
Similar results that fail or are empty render nothing. Both lists cap at three.
No counts, sector, size or careers URL are inferred. Legacy rows keep exploration
but have no mobile apply bar. Preview callers remain unchanged. The mobile-only
bar reuses `PublicApplyLink`, including its existing account-role behavior, with
bottom space reserved independently of optional related content.

`ui.test.tsx` verifies the public UI and pending/resolved composition. The browser
spec is `tests/e2e/vacancy-detail-explore.spec.ts`; run it against the existing
jobs/company-sites fixture harness for 375/1440px and light/dark validation.
It was authored without starting services; browser verification is parent-owned.
