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

With no description or published careers link, T2 should render only company
identity and its other vacancies; omit the block when that list is also empty.
The public `/vacantes` URL grammar does not accept `company_id`; the fallback
“all company vacancies” link therefore also needs parent disposition rather
than passing a silently discarded filter to `buildJobsUrl`.
