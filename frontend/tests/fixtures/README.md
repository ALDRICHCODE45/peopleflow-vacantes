# Jobs and careers-site review fixture

Start from `frontend/`: `node tests/fixtures/jobs-server.mjs` (default `127.0.0.1:4010`).

## Current public API

- `GET /v2/jobs`: strict public list items; `next_cursor` is always a string or null.
- `GET /v2/jobs?company_id=<uuid>`: company-isolated published vacancies, composed with the existing filters, visibility and pagination. Invalid/empty UUID → 400 `invalid_filter`; unknown company → empty list. Requests without `company_id` retain their original pools and behavior.
- `GET /v2/company-sites/nexo-labs`: rich published Nexo Labs snapshot with all 13 visible block types, varied layouts, Spanish copy, SEO, theme, company profile and media refs. Uses the existing vacancy fixture's valid rich-description document/envelope for the story. `Cache-Control: public, max-age=60`.
- `GET /v2/company-sites/nexo-equipo`: old slug; same body with current `slug: "nexo-labs"` (the frontend issues the 308). Unknown slugs → 404 `{error, code: "site_not_found"}` with `no-store`.
- `GET /v2/company-sites/media/{id}`: real WebP bytes, `public, max-age=31536000, immutable`, `nosniff`, sandbox CSP. Unknown IDs → 404 with `no-store`.
- `GET /v2/jobs/{id}`: strict vacancy detail with rich description, requirements profile, compensation, benefits, skills, applicant bucket and screening count.
- `GET /v2/catalogs/languages`
- `GET /v2/geo/countries`
- `GET /v2/geo/countries/MX/states`
- `GET /v2/geo/countries/MX/states/{state}/municipalities` (`19`, `14`)
- `GET /v2/geo/countries/MX/postal-codes/{cp}` (`64000`; other codes return `postal_code_not_found`)

Catalogs are deliberately small, deterministic test data, not a complete Mexican geography database. Unknown states return `state_not_found`.

The URL keys come from `src/features/jobs/url.ts`: repeated work modes, seniorities, states, municipalities and languages; single q, applicant_country, work_schedule, contract_type, professional_area, salary_min/max/currency/period/basis, years_of_experience, education_level and cursor. Repeated dimensions are OR, distinct dimensions AND. Search matches title/description tokens; title matches rank before description-only matches, retaining fixture order on ties.

### Pagination contract (approved fixture semantics)

The first page contains at most **2** filtered rows. It includes `next_cursor: "opaque a+b/c="` **only** if more filtered rows remain; empty and one-page results decode with `next_cursor: null`.

A cursor request models the **final page**, always without another cursor. When further rows exist, it returns all rows remaining after the first page, distinct from the first-page rows. When a cursor is supplied directly on a pool that fits in one page, it returns that single page (or an empty page for an empty pool). This direct-cursor behavior is intentional: the six-filter e2e starts at a nonempty final page without first visiting page one. Do not replace it with unconditional offset slicing, which would empty that direct singleton link. The final page decodes with `next_cursor: null`.

`pending-search` matches a dedicated vacancy and retains the legacy 300 ms response delay. The main vacancy now mentions React in its description; two React-titled vacancies rank ahead of it, so the six-filter React search has two distinct first-page rows and the main vacancy on the final page. All rows still pass the real AND predicates; no search term bypasses matching. The USD contract decoy has an explicit v2 `part_time` schedule, so it fails the active `full_time` predicate rather than leaking through the v1 contract-to-schedule mapping.

Public company careers sites (`src/app/(public)/empresas/[slug]/page.tsx`) can render `/empresas/nexo-labs` against this fixture without the backend. Nexo's company ID is `b478fb93-71b8-47bf-8eaa-b726d63e01a0`; it has **7 published vacancies** across Remoto/Presencial/Híbrido and Nuevo León/Jalisco, all with working detail endpoints. The existing two-row first-page/final-page pagination also applies here (2 + 5); the public renderer follows the continuation to read all seven.

Media IDs `b478fb93-71b8-47bf-8eaa-b726d63e03a0` through `…03a4` represent cover, gallery (two), portrait and story. They intentionally reuse `frontend/public/company/acme-cover.webp` (1600×900), with the original public-domain provenance/credit in `acme-cover.PROVENANCE.txt`. No download or image dependency is needed. This is a warehouse reference photo, **not actual Nexo staff/offices or a portrait**; gallery captions identify reference imagery, and the testimonial/company identities and addresses are fictional review data. The logo also uses this local fixture image. The video is a clearly labeled demonstration embed and is not fetched by the fixture.

Visitor application identity is handled locally by the product's session boundary; screening and CV reads are candidate-only. No authenticated submission API is simulated here.

## Authenticated careers editor API

This is an **in-memory review API**, not an authentication service. Like the employer dashboard fixture, private routes require an `authorization` header starting with `Bearer `; any fixture-only value works. No tokens or sessions are minted. The application's real session/company gate still applies when reviewing through Next.

- `GET /v2/me/company/site`: draft, `draft_version`, nullable `published` metadata, `has_unpublished_changes`, referenced `media`, and `updated_at`. Starts at version 1 with the published Nexo content, not a separate demo model. Responses use `Cache-Control: no-store` and `ETag: "<draft_version>"`.
- `PUT /v2/me/company/site/draft`: full document with `If-Match: "<draft_version>"`. Reuses the **product's `siteDraftSchema`** (including block limits, normalization and rich text), loaded from TypeScript in memory by `site-product-model.cjs`; requires the existing frontend dev dependencies, no build/output files. Canonically identical saves are no-ops; changes increment the version. Missing/malformed preconditions → 428/400; stale version → 412 `version_conflict` with `current` and current ETag. Invalid content → 400 `validation_error`; malformed JSON → 400 `invalid_request`; bodies over 1 MiB → 413.
- `POST /v2/me/company/site/publish`: owner only, with `If-Match`. Product `publishIssues` → 422 `publish_blocked`; success copies the draft and makes it visible on `GET /v2/company-sites/{slug}`. Later draft edits do not alter that snapshot. Public reads omit hidden blocks and unreferenced media. Republished old slugs return the current snapshot/slug.
- `POST /v2/me/company/site/unpublish`: owner only, no precondition; idempotently clears publication. Current and historical public URLs then return 404.
- `GET /v2/me/company/site/slug-availability?slug=...`: own/current and unused valid slugs are available; reserved/invalid slugs return their reason. `otra-empresa` is the deterministic other-company reservation (`taken`, PUT → 409 `slug_taken`). Reserved PUT slugs → 422 `slug_reserved`.
- `POST /v2/me/company/site/media`: multipart **exactly `kind` + `file`**, kinds `cover|gallery|portrait|story`. Returns 201 `{id, kind, url, width, height, content_type}`. Uploaded bytes live in memory and are anonymously readable at the returned `/v2/company-sites/media/{id}` with the same immutable/security headers as seeded media. Save a returned `media_id` to reference it; draft reads list referenced media only. Unknown media refs are rejected. Limits: 5 MiB/file, 200–6000 px/side, 300 uploads; PNG/JPEG/WebP signatures and dimensions are inspected rather than trusting the MIME label.

**Media fixture limitation:** the lightweight header reader is not a full image decoder or production sanitizer; uploads retain their bytes (no EXIF stripping, re-encoding, cropping, S3 or persistence). Use non-sensitive, well-formed test images only. Full malformed-image/security/storage behavior belongs to backend integration tests.

## Compatibility and controls

`/jobs` and `/jobs/{id}` remain because the current e2e suite still directly exercises the old fixture route (`vacantes.spec.ts`, fixture-health test). Employer dashboard routes continue to be delegated to `employer-dashboard.mjs`.

### Careers review controls

- `/__site?brand=orange&font=modern`: default orange `#EA580C` + Moderna.
- `/__site?brand=green&font=editorial`: green `#15803D` + Editorial.
- `/__site?jobs=empty`: empty Nexo jobs state (other companies and the unfiltered pool are unchanged).
- `/__site?jobs=default`: restore Nexo jobs without changing the theme.
- `font=classic` also works. Parameters are optional and composable; omitted values retain their state. Invalid values return 400 without partially applying changes.
- `/__site-draft?role=owner|recruiter`: default owner. Recruiters can read/save/upload but publish/unpublish return 403 `forbidden`.
- `/__site-draft?conflict=next`: the next authenticated PUT simulates another editor's SEO change, increments the server version and returns 412 with the newer `current`. Reads do not consume it; the following PUT behaves normally.
- `/__site-draft?offline=next`: the next authenticated PUT drops its connection without writing. Consumed once; following requests work normally.
- `/__site-draft?mode=new`: replace the draft with product defaults (hero + jobs, null slug/SEO, classic font, `#7835DB`, version 1), clear publication/history and uploads. Public Nexo URL becomes 404 until a valid draft is published.
- `/__site-draft?gate=forbidden|company_inactive|none`: simulate the shared 403 gates on every private site endpoint; `none` clears the gate. Missing Bearer headers still return 401 first.
- Draft-control parameters are optional/composable; invalid values return 400 atomically. If both fault controls are armed, offline is consumed first, conflict on the next PUT. `/__site` remains a visual-review override: it changes draft/published theme together without changing versions; ordinary API saves never do this.
- `/__reset`: restore the original published Nexo snapshot/draft/version, owner role, no gates or one-shot faults, orange/modern, Nexo vacancies and all existing jobs-control defaults; uploaded media URLs become 404. Site/media/control reads are not logged as jobs requests and do not inherit jobs failure/delay.

All existing controls remain: `/__health`, `/__reset`, `/__requests`, `/__failure?kind=5xx|schema|timeout`, `/__recover`, `/__visibility?id=...&visible=true|false`, `/__visibility?hidden=0|1`, `/__delay?ms=0..5000`. Failures remain armed until recovery/reset; recovery retains history; reset clears history, visibility, failure and delay. Controls/catalogs do not enter the jobs request log or inherit jobs failure/delay. List logs remain query-only (`""` on the canonical unfiltered v2 list), detail logs record the exact pathname including `/v2`.

Existing detail IDs retained (prefix `0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c`): `7d8e`, `7d90`, `7d92`, `7d94`, `7d96`. Added `7db0` (Pending Search), `7db1` and `7db2` (React roles), with matching detail endpoints. Existing sentinel pools and company IDs are retained. The default v2 pool includes the main, rich-detail, USD, React and Pending Search vacancies; the first page contains the main and rich-detail vacancies.

## Validation

From `frontend/`:

```sh
pnpm exec vitest run --config tests/fixtures/vitest.config.ts
node tests/fixtures/public-pages-smoke.mjs
PLAYWRIGHT_FIXTURE_ORIGIN=http://127.0.0.1:4010 pnpm exec playwright test tests/e2e/vacantes.spec.ts tests/e2e/vacantes-a11y.spec.ts --reporter=line --output tests/fixtures/playwright-results
PLAYWRIGHT_FIXTURE_ORIGIN=http://127.0.0.1:4010 pnpm exec playwright test tests/e2e/vacantes.spec.ts -g "recovers after timeout" --repeat-each=3 --reporter=line --output tests/fixtures/playwright-timeout-results
```

The isolated Vitest fixture binds an ephemeral port and uses the product's own public careers-site decoder, publish validator, strict list, detail, language and geography validators on HTTP responses. Careers tests cover the exact response keys, old/unknown slugs, all visible block types, branding/reset/empty controls, media bytes and headers, seven company-isolated jobs, filter conjunction, pagination, UUID errors and working job details. It also covers logging, filtering, hidden vacancies, persistent failure/recovery, timeout, delay and reset. The browser smoke needs the production app on `:3100` and fixture on `:4010`; it verifies real list content, the rich detail article/benefits and the visitor gate. Playwright output is confined to this fixture directory.

Draft extension test-first validation: **RED 6 failed / 11 passed → GREEN 17/17 passed**; delayed-writer CAS regression **RED 1 failed / 17 passed → GREEN 18/18 passed (exit 0)**. HTTP tests decode draft/error/availability/upload responses with the product schemas and cover CAS/no-op (including an overlapping streamed PUT), validation, snapshot isolation, publish/unpublish, old slugs, role/company gates, fresh defaults, one-shot faults, real media bytes and reset. The original eleven public/jobs tests remain green.

T6a test-first validation: **RED 4 failed / 7 passed → GREEN 11/11 passed (exit 0)**.

Prior browser results after the pagination/sentinel corrections (not rerun for T6a): Both unchanged list specs: **54 passed / 7 failed (exit 1)**; the requested pending-search, six-filter React pagination and USD conjunction cases pass, as does canonicalization. Timeout recovery separately: **3/3 repetitions pass (exit 0)**, also passing in the full run.

Remaining full-run failures:

- `vacantes-a11y.spec.ts:140`: keyboard-focus coverage expects a next-page link for singleton `q=frontend` results. With honest pagination no such link exists.
- `vacantes.spec.ts:219`: hero/layout test expects no desktop header login link, but one renders.
- `vacantes.spec.ts:422`: obsolete featured prototype status bubble.
- `vacantes.spec.ts:492`: obsolete disclosed prototype card (also expects only one default row).
- `vacantes.spec.ts:841`: pending-next test expects a next link for singleton `q=frontend` results. As above, advertising it would violate the approved no-phantom-pagination rule.
- `vacantes.spec.ts:968`: browser Back reaches `/vacantes` but the search control still contains `frontend`.
- `vacantes.spec.ts:1389`: obsolete dual-login menu.

Do not grow the `frontend` result pool merely to force the two next-link assertions green: unchanged visibility tests deliberately require that query to contain only the mutable main vacancy. These remaining assertions/product behaviors are outside fixture-only ownership.

### Local photos for visual reviews

`COMPANY_SITE_FIXTURE_IMAGES=/path/a.png:/path/b.jpg node tests/fixtures/jobs-server.mjs` serves those local files
(assigned to the site's media in order, round-robin; `.png`, `.webp`, otherwise JPEG) instead of the committed reference
image. Use it only to judge composition with realistic photos; never commit the photos.
