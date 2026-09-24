# Proposal: Public job discovery frontend

## Intent

Introduce a standalone Next.js 15 App Router application under `frontend/` that lets anonymous users in Mexico discover and read currently visible PeopleFlow vacancies. The first slice should be trustworthy and shareable: real API-backed data, URL-addressable filters, forward cursor navigation, complete loading/empty/error/not-found states, and an accessible responsive experience that evolves the existing PeopleFlow identity without copying unsupported mockup behavior.

## Scope

### In scope

- Create the standalone `frontend/` application using pnpm, Next.js 15 App Router, SSR/RSC-first rendering, and AWS Amplify-compatible runtime behavior.
- Implement public `/vacantes` and `/vacantes/[jobId]` routes using thin App Router composition.
- Organize job behavior under the approved `frontend/src/features/jobs` screaming architecture, with shared transport and environment concerns kept in their approved locations.
- Read the existing public `GET /jobs` and `GET /jobs/{id}` contracts without backend changes.
- Support only the backend's scalar URL filters: `q`, `seniority`, `work_mode`, `employment_type`, `location`, and `currency` (`MXN` or `USD`); support opaque forward `cursor` navigation while preserving active filters.
- Canonicalize all supported query state, including exact `currency` values, omit empty/default values, reset cursors when filters change, and retain browser share/back/forward behavior.
- Validate list/detail responses at the frontend boundary, classify transport/status failures, and map user-facing errors to concise Mexico Spanish messages.
- Render only API-backed fields, including plain-text descriptions with safe paragraph/line-break preservation, Mexico Spanish date/currency formatting, and omission-safe optional fields.
- Provide responsive desktop filters and an accessible mobile Sheet, semantic result/detail markup, keyboard-visible focus, touch-sized controls, and WCAG AA contrast in both themes.
- Provide layout-matched loading/pending feedback, empty results with a clear reset path, retryable API/schema error states, and branded detail not-found handling.
- Establish frontend-local unit, component, page/data, browser, type-check, lint, production-build, and accessibility verification appropriate to the new application, while leaving backend commands unchanged.

### Out of scope

- Landing-page completion, authentication, applying, saving, sharing, login prompts, candidate or employer workspaces, publishing, and company-profile functionality.
- Backend API, database, DTO, query, pagination, or CORS changes. The existing backend jobs feature under `backend/internal/features/jobs/` remains the integration contract and is not modified.
- Unsupported multi-value variants of the scalar filters (including `currency`), company-name search, technology/area filters, sorting controls, result totals, page-number pagination, reverse cursor navigation, featured jobs, applicant/response-time claims, benefits, or fabricated structured job fields.
- Fake or placeholder vacancy data, browser-direct API fetching, a frontend API proxy, on-demand ISR, `revalidateTag`, `revalidatePath`, and correctness depending on streamed responses.
- Shared root README, OpenSpec config, CI, or other project-wide changes; any such coordination is separate from this change.

## Affected capabilities and areas

- **New frontend runtime:** `frontend/` application, package manifest/lockfile, App Router, local tooling, and frontend test setup.
- **Public job discovery:** list search/filter/cursor flow and vacancy detail flow.
- **Jobs feature:** API client methods, schemas, typed filters, URL parsing/canonicalization, formatters, view components, and state/error mapping under `frontend/src/features/jobs/`.
- **Shared frontend foundations:** server-only environment parsing, genuinely cross-feature fetch/status/JSON transport, shadcn/ui Base UI primitives, brand assets/components, public shell, metadata, and global semantic theme tokens.
- **Existing backend dependency:** read-only consumption of the public jobs endpoints and their behavior documented by `openspec/specs/jobs/spec.md` and implemented under `backend/internal/features/jobs/`.
- **Hosting/rendering:** dynamic `no-store` SSR for fresh vacancy visibility on Amplify; no build-time dependency on API availability.

## Proposed approach

Keep route files and route-group layouts as composition only. Server Components should own initial list/detail data fetching, metadata, and rendering; isolated Client Component leaves should handle pending navigation/search feedback, mobile filter presentation, and optional theme control. Centralize server-side API transport and validate every response against schemas that allow omitted optional fields and reject malformed payloads.

Use regular links/navigation so filtered and cursor URLs are crawlable, refresh-safe, and history-preserving. Treat cursor values as opaque, and treat `currency` as a supported single-select filter with canonical `MXN`/`USD` values. Use the approved PeopleFlow wordmark and purple-led dark/light token direction with restrained visual effects, Mexico Spanish copy, accessible semantic shadcn compositions, deterministic server formatting, and low functional motion that honors reduced-motion preferences.

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Mockups imply data or actions the API does not provide | Define UI strictly from the list/detail API payloads; omit unsupported claims and controls. |
| Scalar backend filters conflict with multi-select mockup controls | Use one value per filter, including exact `MXN`/`USD` currency selection, and document multi-value support as future backend scope. |
| Opaque cursors become invalid or are combined with changed filters | Preserve returned values unchanged and remove `cursor` whenever any filter changes. |
| API downtime, malformed payloads, or hosting transport differences | Use request timeout/status/schema boundaries, contextual Spanish error states, retry navigation, safe logging, and non-stream-dependent correctness. |
| Dynamic SSR increases request-time API reads | Accept freshness as the first-slice tradeoff; require a new hosting decision before adding caching. |
| Public detail URLs expose hidden or malformed jobs | Validate UUID shape before fetching and map backend `404` to the not-found boundary. |
| Hydration or layout instability from formatting/assets/fonts | Format deterministically on the server, reserve media dimensions, and use licensed `next/font` or approved local assets. |
| New frontend tooling diverges from backend-centric config | Keep frontend commands and dependencies local to `frontend/`; coordinate shared config changes separately. |

## Rollback

The change is additive and has no backend or database migration. Roll back by removing or disabling the `frontend/` deployment artifact and reverting the change-folder implementation commits; existing backend job discovery remains unaffected. If only a frontend defect is found, revert the affected route/feature commit or temporarily disable the public frontend deployment while preserving the backend API. Do not introduce a cache rollback path, schema migration rollback, or API compatibility shim because this proposal changes no shared API surface.

## Measurable success criteria

- Anonymous users can load `/vacantes` and `/vacantes/[jobId]` in a production build and see only validated live API data.
- Every supported filter, including single-select `currency=MXN` or `currency=USD`, produces a canonical shareable URL; changing any filter removes the prior cursor, and next-page navigation preserves filters and the opaque cursor.
- URL parsing/canonicalization tests cover valid currency values, omission of empty/default currency state, rejection or removal of unsupported currency values, and cursor reset/preservation when currency changes.
- List and detail behavior has automated coverage for success, omitted optional fields, empty results, invalid schema, transport/5xx failures, `404`, malformed UUIDs, reset/preservation rules, and responsive filter accessibility.
- The UI exposes no unsupported totals, sorting, multi-select semantics, fabricated fields, application/auth actions, or fake vacancy data.
- Loading, empty, error, and not-found states are actionable, written in Mexico Spanish, keyboard accessible, and correct without streaming or ISR.
- Production checks pass from `frontend/` (frozen install, type-check, lint, tests, build, and accessibility check), and backend behavior/tests remain unchanged.
- Manual/browser verification confirms responsive layouts below 768px, visible focus, safe long-content wrapping, both theme modes, reduced-motion behavior, and browser back/forward navigation.

## Delivery guardrails

Implementation must remain limited to the `frontend/` application and this change folder unless separately coordinated. Specs, design, and tasks should refine this proposal without widening the confirmed product boundaries.
