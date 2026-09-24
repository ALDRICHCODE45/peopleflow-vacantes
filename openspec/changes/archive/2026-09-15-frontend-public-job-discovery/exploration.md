# Exploration: Frontend Public Job Discovery

## Executive answer

A standalone Next.js 15 App Router application can be introduced under `frontend/` without changing the existing Go job API. The first slice should render anonymous `/vacantes` and `/vacantes/[jobId]` pages from Server Components, keep supported search/filter/cursor state in the URL, validate every API response at the frontend boundary, and use small Client Component leaves only for navigation affordances, theme control, and responsive filters.

The main constraints are contractual rather than structural: the backend supports only single-value filters and forward cursor pagination; it does not provide totals, arbitrary sorting, company-name search, technology/area filters, or the rich detail data shown in the HTML mockups. The frontend must not fake those capabilities. Amplify’s current support boundary also contradicts `docs/decision-frontend-hosting.md`: this slice must use uncached dynamic SSR and must not depend on on-demand ISR or streamed responses.

**Design read:** Reading this as a public job-discovery product for Mexico-based candidates, with a trustworthy, focused evolution of PeopleFlow’s dark/light purple identity rather than a literal mockup port or a generic job-board redesign.

## Repository baseline

- `frontend/`, every `package.json`, and every pnpm lockfile are absent. There is no existing frontend runtime, component registry, lint/test setup, or package-manager state to preserve.
- `README.md` already reserves `/frontend` for “Next.js (App Router, SSR/RSC)” on Amplify Hosting.
- `openspec/config.yaml` is backend-centric: its test runner and phase guidance currently name only Go commands and backend paths. Frontend verification must therefore be specified explicitly in this change rather than inferred from the current config.
- Planning is file-backed OpenSpec. No application or shared root/config/docs files were changed during exploration.

## Existing product and visual evidence

The mockups in `design/screens/vacantes-listado.html`, `design/screens/vacante-detalle.html`, and `design/screens/assets/base.css` establish reusable identity material:

- PeopleFlow wordmarks already exist in dark and light WebP variants.
- The identity uses deep violet-black/off-white surfaces, purple as the primary accent, rounded controls, restrained cyan/green secondary signals, Clash Display/Inter/JetBrains Mono, and a dark/light theme toggle.
- The list concept has a search-led heading, filters, compact vacancy rows, salary metadata, and responsive two-column structure.
- The detail concept has a strong job/company header, readable long-form content, and a sticky action rail.

The HTML is a visual reference, not a data or behavior contract. It contains several unsupported or excluded concepts: Argentina-centric copy, result totals, featured jobs, company-name/technology search, area filters, numbered pagination, applicant counts, response-time claims, benefits, structured responsibilities/requirements/stack, company profile metadata, saving, sharing, login, publishing, and application CTAs. Those must not be carried into this slice unless the API later supplies them and scope changes.

Recommended evolution for this slice:

- Retain the wordmark, semantic dark/light token idea, purple accent, generous rounded geometry, and strong display hierarchy.
- Reduce ambient glows, decorative grid density, hover lift, and dashboard-like chrome so job content remains primary and accessible.
- Use Mexico Spanish labels and formatting (`Remoto`, `Híbrido`, `Presencial`; `Tiempo completo`; MXN/USD through `Intl.NumberFormat("es-MX")`).
- Prefer readable result rows and typographic grouping over wrapping every datum in a card.
- Treat job `description` as untrusted plain text with preserved paragraphs/line breaks; do not parse it as HTML or invent semantic sections.
- Keep motion low and functional; no behavior should require animation, and reduced-motion preferences must be respected.

## Backend contract available to the frontend

### List

`GET /jobs` is public and returns:

```json
{
  "items": [
    {
      "id": "uuid",
      "title": "Frontend Engineer",
      "description": "...",
      "work_mode": "hybrid",
      "employment_type": "full_time",
      "seniority": "mid",
      "location": "CDMX",
      "salary_min": 50000,
      "salary_max": 80000,
      "salary_currency": "MXN",
      "published_at": "2026-08-05T12:00:00Z",
      "company": { "id": "uuid", "name": "Acme SA" }
    }
  ],
  "next_cursor": "opaque-string"
}
```

`items` is always an array. `next_cursor` is omitted on the final page. `location`, either salary bound, and `published_at` may be omitted by the DTO, although visible jobs should have `published_at` under the database invariant.

Supported query parameters are:

| URL key | Backend behavior | Frontend implication |
| --- | --- | --- |
| `q` | Spanish full-text search over job title and description only | Do not promise company-name search. |
| `seniority` | One enum value: `intern`, `junior`, `mid`, `senior`, `lead` | Single-select, not checkbox OR filters. |
| `work_mode` | One enum value: `onsite`, `remote`, `hybrid` | Single-select. |
| `employment_type` | One enum value: `full_time`, `part_time`, `contract`, `internship` | Single-select. |
| `location` | Case-insensitive substring | Free-text value. |
| `currency` | Exact `MXN` or `USD` match | Single-select. |
| `cursor` | Opaque keyset anchor | Preserve unchanged; never decode client-side. |
| `limit` | Positive integer; default 20 | Prefer the backend default for this slice. |

Unknown parameters, malformed cursors, and invalid enum values are tolerated by the backend. The frontend should canonicalize its own supported parameters, omit empty/default values, and drop `cursor` whenever any search/filter value changes. Unrecognized query keys should not become UI state.

The ordering is fixed: relevance first when `q` exists, then `published_at DESC`, then `id DESC`; browse mode is newest-first. The mockup’s sort control is therefore misleading and should be omitted.

Cursor pagination is forward-only and has no total count. The correct UI is a “Cargar más vacantes”/“Siguiente” affordance whose destination includes the returned cursor, not page numbers or “142 vacantes”. URL navigation can preserve browser back behavior without inventing a reverse cursor.

### Detail

`GET /jobs/{id}` is public and returns the same bare job object used for a list item. It returns:

- `200` for a visible published vacancy owned by a live active company;
- `404` for nonexistent, draft, closed, soft-deleted, or company-hidden vacancies;
- `400` for a malformed UUID;
- the stable JSON error envelope `{ "error": "...", "code": "..." }` for errors.

The route should reject malformed UUID-like `jobId` values as not found before calling the API, and map backend `404` to Next’s not-found boundary. Unexpected transport, `5xx`, and schema-validation failures belong to an error boundary, not the not-found state.

### Integration boundary

- The API is mounted at root paths such as `/jobs`; no `/api/v1` prefix exists.
- No CORS middleware was found. That does not block the SSR-first design because Server Components can call the API server-to-server.
- A server-only API base URL should be required by the frontend. A `NEXT_PUBLIC_*` URL and browser-direct fetches are unnecessary for this anonymous read slice.
- The frontend should centralize fetch, timeout/abort, status classification, JSON decoding, and schema validation. A schema library such as Zod is a reasonable new local dependency, but the exact dependency belongs in design/tasks because no frontend package manifest exists yet.
- Validation schemas must reflect omitted nullable fields rather than requiring explicit `null`, and must reject/diagnose invalid enums, IDs, timestamps, envelope shapes, and malformed list/detail payloads.
- Backend English error strings are not UI copy. Stable error codes/statuses should be mapped to concise Mexico Spanish messages while internal details remain server-side.

## Recommended frontend architecture

The canonical frontend structure follows screaming architecture: framework composition stays thin, while the jobs feature owns its domain behavior.

```text
frontend/src/app/                  # thin App Router composition
frontend/src/features/jobs/        # job-domain api/components/schemas/types
frontend/src/components/ui/        # shadcn-managed primitives only
frontend/src/components/brand/     # brand-level shared components
frontend/src/components/shells/    # public/candidate/employer shells
frontend/src/lib/api/              # genuinely cross-feature transport
frontend/src/lib/env/              # environment boundary
frontend/public/brand/             # approved assets
```

The approved App Router route-group topology remains the long-term composition model:

```text
frontend/src/app/
├── layout.tsx
├── globals.css
├── (public)/
│   ├── layout.tsx
│   └── vacantes/
│       ├── page.tsx
│       └── [jobId]/
│           ├── page.tsx
│           └── not-found.tsx
├── (candidate)/                   # reserved for a future candidate area
└── (employer)/                    # reserved for a future employer area
```

Only the `(public)/vacantes` list and detail routes are implemented by this change. The `(candidate)` and `(employer)` groups and their matching shells document the approved future topology; they do not authorize candidate or employer routes, authentication, or workspace functionality in this slice.

Architecture guidance:

- Route files and route-group layouts remain thin App Router composition. Job result/detail rendering, filter behavior, URL canonicalization, response schemas, API-facing job operations, formatters, and job-domain types belong under `frontend/src/features/jobs/`.
- Pages, result rendering, detail rendering, API calls, and metadata should remain Server Components by default, with route files delegating domain behavior to the jobs feature.
- `frontend/src/components/ui/` is reserved for shadcn-managed primitives; it must not contain business components. Brand-level shared elements and cross-area shells belong only in their named shared folders.
- `frontend/src/lib/api/` contains only genuinely cross-feature transport concerns such as the shared fetch/status/JSON boundary. Jobs endpoints, payload schemas, and job-specific error mapping stay in `features/jobs`; `frontend/src/lib/env/` owns environment parsing and server-only configuration.
- Generic `services`, `helpers`, or `shared` dumping grounds are prohibited. Code stays feature-owned unless it has a demonstrated cross-feature role, and neither `components/jobs` nor `lib/jobs` is part of the recommended architecture.
- In Next.js 15, `params` and `searchParams` are asynchronous and must be awaited.
- Parse the query string into a typed canonical filter model before constructing the backend URL. Keep this parser pure and unit tested inside the jobs feature.
- Use regular GET semantics and links/router navigation so filtered views are shareable, refresh-safe, crawlable, and compatible with browser history.
- Isolate only interactive leaves as Client Components: search/filter submission feedback, mobile filter Sheet, and optional theme control. Do not place the result tree behind a broad client boundary.
- Initialize shadcn/ui for RSC with Base UI primitives and semantic tokens. Likely compositions are Button, Input/InputGroup, Select, Badge, Sheet, Alert, Empty, Skeleton, Separator, and Card only where hierarchy warrants it. Component APIs must be verified with the shadcn CLI during implementation rather than guessed now.
- Use `next/font` or approved self-hosted files, not the mockups’ external `<link>` tags. Font licensing/availability must be confirmed before selecting Clash Display for production.
- Use `next/image` for approved assets under `frontend/public/brand/` and reserve dimensions to avoid layout shift.

## Rendering, freshness, and Amplify compatibility

`docs/decision-frontend-hosting.md` claims Amplify manages coherent on-demand ISR and recommends `revalidateTag`/`revalidatePath`. Current Amplify support documentation, as identified in the approved context, lists on-demand ISR and Next.js streaming as unsupported. The repository decision is stale on those details.

For this slice:

- Keep Amplify Hosting and Next.js 15 as confirmed.
- Fetch job data dynamically with no persistent Next data/full-route cache (`cache: "no-store"` or an equivalent explicit dynamic policy).
- Do not call `revalidateTag` or `revalidatePath`, and do not design freshness around ISR.
- Do not depend on Suspense or `loading.tsx` streaming for correctness. Initial SSR may wait for the completed API response.
- Still provide loading feedback for client-initiated filter/pagination navigation through an isolated pending-state control and layout-matched skeleton/disabled state. If Amplify buffers an RSC response, the page remains correct.
- Avoid a frontend route-handler proxy unless later infrastructure requires one; server-side data access already avoids CORS and an extra hop.

This makes published/closed changes visible on the next request and avoids stale public vacancies at the cost of one backend read per rendered page. Any future caching strategy requires a fresh hosting-capability decision.

## State and UX behavior

### List state matrix

| State | Expected behavior |
| --- | --- |
| Initial browse | SSR first 20 visible jobs, newest first. |
| Search/filter | URL is the source of truth; cursor resets; SSR renders canonical result. |
| Loading navigation | Submitting controls become pending/disabled and expose an accessible status; correctness does not depend on streamed fallback. |
| Empty | Explain that no vacancies match and offer a clear link to remove filters. |
| API/transport/schema error | Spanish contextual error with retry navigation; log safe server detail. |
| More results | Follow opaque `next_cursor` while preserving active filters. |
| Final page | No disabled fake pagination; simply omit the next action. |

### Detail state matrix

| State | Expected behavior |
| --- | --- |
| Success | Render only API-backed title, company, location, mode, employment type, seniority, salary, publish date, and plain-text description. |
| Missing/invisible/malformed ID | Branded not-found view with a link back to `/vacantes`. |
| API/transport/schema error | Route error state with retry and list navigation. |
| Loading navigation | Pending link/page feedback without relying on streamed HTML. |

Application, save, share, login, candidate workspace, employer publishing, and company profile actions must not appear as active functionality. A neutral “Volver a vacantes” action is sufficient on detail.

## Accessibility and responsive expectations

- Use one `h1` per route, semantic result lists/articles, descriptive links, and real labeled controls; placeholders cannot replace labels.
- Preserve keyboard-visible focus, 44px-equivalent touch targets where practical, logical tab order, and WCAG AA contrast in both themes.
- Announce pending/results state changes without moving focus unexpectedly.
- Desktop filters may sit beside results; below 768px they should collapse into an accessible Sheet with a required title. Essential search remains visible without opening the Sheet.
- Long titles, company names, locations, salary ranges, and descriptions must wrap safely; no fixed-height result cards.
- Dates and currency require deterministic server formatting to avoid hydration mismatch.
- Do not infer logo colors or job tags from company names. Initials may be decorative only if text identity remains present.

## Test strategy

Because no frontend test stack exists, this change should establish frontend-local commands and keep backend commands untouched unless coordinated.

1. **Pure unit tests:** URL parsing/canonicalization, enum label mapping, cursor reset/preservation, salary/date formatting, and response schemas.
2. **Component tests:** result item omissions, empty/error states, filter labels and keyboard behavior, mobile Sheet accessibility, and pending states.
3. **Page/data tests:** list and detail status mapping using mocked fetch responses, including omitted optional fields, invalid schema, `404`, malformed UUID, and `5xx`.
4. **Browser tests:** shareable filtered URL, back/forward navigation, next-cursor navigation, responsive filter flow, focus visibility, and detail not-found.
5. **Build/type/lint gates:** pnpm frozen-lockfile install, type-check, lint, tests, production build, and an accessibility check. Lighthouse/Core Web Vitals checks should be added when a runnable deployment exists.

Strict TDD should apply to frontend production behavior even though current OpenSpec test commands describe only Go.

## Risks and design-phase decisions still needed

| Risk/question | Recommendation |
| --- | --- |
| Rich mockup exceeds API data | Define UI strictly from `SearchJobsItem`; no fabricated fields or actions. |
| Mockup multi-select filters conflict with scalar API | Use one value per filter in this slice; an OR/multi-value backend change is separate scope. |
| Cursor URLs can be long/opaque | Treat cursor as an opaque URL value and never persist it when filters change. |
| No total or reverse cursor | Use forward next navigation and browser history; omit counts/page numbers. |
| API unavailable at build time | Do not pre-render job data during build; routes must render dynamically at request time. |
| Amplify feature mismatch | Lock no-store SSR and non-stream-dependent loading; record the stale hosting document for coordinated follow-up. |
| No CORS | Keep data fetching server-side; do not add browser-direct integration in this slice. |
| Fontshare/Google links in prototypes | Select licensed `next/font` or self-hosted assets during design; external runtime font CSS is not the production path. |
| Public content and SEO | Add route metadata, canonical query policy, semantic headings, and not-found handling; decide in design whether filtered/cursor pages should be indexed. |
| Shared configuration ownership | Keep lockfile and tooling under `frontend/`; coordinate any root README/OpenSpec config/CI edits before implementation. |

## Scope boundary for the next phase

A proposal can proceed without more product discovery if it preserves the confirmed decisions and treats the following as fixed for the first slice: two public routes, server-side API access, scalar URL filters, forward cursor pagination, no-store SSR, schema validation, Mexico Spanish UI, evolved PeopleFlow identity, complete state handling, and frontend-local tests/tooling.

The proposal must not include landing-page completion, authentication, applications, candidate/employer workspaces, backend API expansion, fake mockup data, on-demand ISR, or streaming-dependent behavior.

## Evidence index

- Product/repository: `README.md`, `openspec/config.yaml`, `docs/decision-frontend-hosting.md`.
- Canonical API: `openspec/specs/jobs/spec.md`.
- HTTP/DTO behavior: `backend/internal/features/jobs/infrastructure/http/jobHandler.go`, `backend/internal/features/jobs/infrastructure/http/handler_test.go`, `backend/internal/features/jobs/application/dtos/searchJobsDto.go`.
- Query/pagination behavior: `backend/internal/features/jobs/application/usecases/searchJobs.go`, `backend/db/queries/jobs.sql`.
- Runtime/error boundary: `backend/cmd/api/main.go`, `backend/internal/shared/httpjson/errors.go`.
- Development data: `backend/db/migrations/00008_jobs_seed.sql`.
- Visual references: `design/landing-preview/`, `design/screens/vacantes-listado.html`, `design/screens/vacante-detalle.html`, `design/screens/assets/base.css`, and PeopleFlow wordmark assets.
