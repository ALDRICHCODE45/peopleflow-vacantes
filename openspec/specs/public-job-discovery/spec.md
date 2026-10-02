# Public Job Discovery Specification

## Purpose

Provide an anonymous, trustworthy PeopleFlow vacancy discovery experience for candidates in Mexico. The capability consists of a public vacancy list at `/vacantes` and a public vacancy detail route at `/vacantes/[jobId]`, using the existing public jobs API as a read-only dependency.

## Scope boundaries

This capability MUST NOT add or imply authentication, applications, saving, sharing, login prompts, candidate or employer workspaces, publishing, company profiles, landing-page completion, or other job-board actions not supplied by the public jobs API.

It MUST NOT expose or promise result totals, sorting, page-number or reverse-cursor pagination, featured jobs, applicant or response-time claims, benefits, structured responsibilities/requirements/technology fields, company-name search, technology or area filters, multi-value filter semantics, currency conversion, or fabricated vacancy data.

The backend `jobs` capability remains the source contract for visibility, fields, filters, and pagination. This frontend capability MUST NOT change backend job semantics or require on-demand ISR, `revalidateTag`, `revalidatePath`, or streamed responses for correctness.

## Requirements

### Requirement: Public Vacancy Routes

The system MUST provide anonymous public vacancy list and detail routes. The list MUST render visible vacancies returned by the public jobs endpoint. The detail route MUST render a visible vacancy returned by the public job detail endpoint and MUST provide a neutral path back to the vacancy list.

#### Scenario: Anonymous candidate browses vacancies

- GIVEN an anonymous visitor requests `/vacantes`
- WHEN the public jobs service returns a valid list response
- THEN the page renders the returned visible vacancies without requiring authentication

#### Scenario: Anonymous candidate opens a visible vacancy

- GIVEN an anonymous visitor requests `/vacantes/{jobId}` for a visible vacancy
- WHEN the public job detail service returns a valid vacancy
- THEN the page renders that vacancy without requiring authentication

#### Scenario: Detail page provides list navigation

- GIVEN an anonymous visitor is viewing a vacancy detail page
- WHEN the visitor activates the list-navigation action
- THEN the visitor is taken to `/vacantes` without an authentication or application prompt

### Requirement: Minimal Public Root Entry

The system MUST provide an anonymous minimal public root entry at `/` using the public shell and a clear link to `/vacantes`. This entry MUST remain a navigation point for public vacancy discovery rather than a completed marketing landing page, and MUST NOT introduce unsupported product claims or actions.

#### Scenario: Anonymous visitor starts at the public root

- GIVEN an anonymous visitor requests `/`
- WHEN the root entry renders
- THEN the public shell provides a clear link to `/vacantes` without presenting full landing-page content, unsupported product claims, or out-of-scope actions

### Requirement: Validated API-Backed Vacancy Content

The system MUST validate every list and detail response before rendering it. It MUST render only fields supplied by the public jobs contract, accept contract-allowed omitted optional fields, and treat a malformed response as an API/schema error rather than rendering partial or invented vacancy content.

The system MUST render descriptions as untrusted plain text, preserving meaningful paragraphs and line breaks without interpreting supplied content as HTML. It MUST omit unavailable optional metadata instead of displaying placeholders or fabricated values.

#### Scenario: List item renders only validated contract data

- GIVEN a valid vacancy list item containing title, description, work mode, employment type, seniority, company identity, and optional salary, location, or publication date fields
- WHEN the list page renders the item
- THEN the page shows only those validated contract fields and does not show unsupported claims or controls

#### Scenario: Omitted optional fields remain omission-safe

- GIVEN a valid vacancy whose location, one or both salary bounds, or publication date is omitted
- WHEN the vacancy is rendered in the list or detail view
- THEN the page omits the unavailable value without showing `undefined`, a fake value, or a misleading empty claim

#### Scenario: Description markup is displayed safely as text

- GIVEN a valid vacancy description containing paragraphs, line breaks, or text that resembles HTML
- WHEN the detail page renders the description
- THEN the page preserves readable paragraph and line-break structure and displays the content as text rather than interpreting it as markup

#### Scenario: Malformed API data is not rendered as a vacancy

- GIVEN the jobs service returns an invalid identifier, enum, timestamp, envelope, item shape, or detail shape
- WHEN the frontend validates the response
- THEN the page enters its API/schema error state and does not render the malformed vacancy as trusted content

### Requirement: Supported Scalar Search and Filters

The list MUST support only the scalar URL filters `q`, `seniority`, `work_mode`, `employment_type`, `location`, and `currency`. Each filter MUST represent at most one value. The frontend MUST use the backend wire values for enum filters and MUST treat `currency` as an exact single value of `MXN` or `USD`, with no conversion between currencies.

The search experience MUST NOT claim that `q` searches company names. Supported filters MUST combine as an AND query, and the UI MUST NOT expose unsupported multi-select, sorting, totals, technology, area, or company-name filter behavior.

#### Scenario: Currency filter selects one exact currency

- GIVEN visible vacancies with `salary_currency` values of `MXN` and `USD`
- WHEN the visitor selects `currency=MXN` or `currency=USD`
- THEN the list requests and renders only vacancies matching that exact currency and does not convert salary values

#### Scenario: Filters combine with AND semantics

- GIVEN visible vacancies with different seniority, work mode, employment type, location, and search text values
- WHEN the visitor submits multiple supported filters
- THEN the list contains only vacancies matching every selected filter

#### Scenario: Scalar controls do not imply multi-value filtering

- GIVEN the visitor is choosing a seniority, work mode, employment type, or currency filter
- WHEN the filter control is displayed
- THEN it permits one value or no value and does not present checkbox-OR or multi-value semantics

#### Scenario: Search copy describes supported search scope

- GIVEN the visitor views or uses the `q` search control
- WHEN the search label or supporting copy is presented
- THEN it describes job discovery without claiming company-name search

### Requirement: Canonical Shareable URL State

The URL MUST be the source of truth for list search and filter state. The system MUST produce a canonical, shareable `/vacantes` URL containing only supported, non-empty state. Empty values, the unselected/default filter state, unknown query keys, and invalid supported values MUST be removed from canonical UI state. Explicit valid `currency=MXN` and `currency=USD` values MUST remain exact when selected.

The system MUST preserve browser refresh, share, back, and forward behavior for canonical list URLs. A non-canonical request MUST be normalized to equivalent supported state before it is used to render or request results.

#### Scenario: Valid filter state produces a canonical URL

- GIVEN a visitor submits a non-empty search, valid scalar filters, and a valid currency value
- WHEN the list state is committed
- THEN the browser URL contains the supported values in canonical form and can reproduce the same filtered list after refresh

#### Scenario: Empty and default state is omitted

- GIVEN a visitor clears a search or returns a filter to its unselected/default state
- WHEN the list state is committed
- THEN the corresponding empty/default query parameter is absent from the URL

#### Scenario: Invalid and unknown query state is removed

- GIVEN a visitor requests `/vacantes` with an unsupported query key or an invalid enum or currency value
- WHEN the page canonicalizes the query
- THEN unsupported state is ignored or removed, the page does not expose it as a filter, and the canonical URL contains no invalid supported value

#### Scenario: Explicit currency values remain exact

- GIVEN a visitor selects `MXN` or `USD`
- WHEN the canonical URL is generated
- THEN it contains the exact uppercase value selected and does not lowercase, translate, convert, or replace it with another currency

#### Scenario: Browser history restores prior canonical results

- GIVEN a visitor has visited two different canonical filtered list URLs
- WHEN the visitor uses browser back or forward navigation
- THEN the corresponding URL and filtered result state are restored without inventing client-only state

### Requirement: Opaque Forward Cursor Navigation

The list MUST support forward navigation using only the opaque `cursor` returned by the jobs service. The frontend MUST preserve a returned cursor unchanged as a URL value, MUST NOT decode, inspect, manufacture, or use it as a page number, and MUST preserve all active supported filters when creating the next-results destination.

The list MUST show a next-results action only when the response contains `next_cursor`. It MUST omit that action when no next cursor is returned and MUST NOT show totals or reverse-pagination controls.

#### Scenario: Next navigation preserves filters and cursor

- GIVEN a valid filtered list response containing `next_cursor`
- WHEN the visitor activates the next-results action
- THEN the destination contains the active filters and the returned cursor unchanged

#### Scenario: Cursor is treated as opaque

- GIVEN the jobs service returns a cursor containing arbitrary opaque content
- WHEN the frontend builds the next-results URL
- THEN the cursor value is transported without client-side decoding or semantic transformation

#### Scenario: Final page has no fake pagination action

- GIVEN a valid list response without `next_cursor`
- WHEN the list page renders
- THEN it omits the next-results action and does not display a disabled placeholder, total count, page number, or reverse-navigation control

#### Scenario: Filter changes reset pagination

- GIVEN the current list URL contains active filters and a cursor
- WHEN the visitor changes, adds, or clears any search or filter value, including currency
- THEN the resulting canonical URL removes `cursor` before requesting the changed result set

### Requirement: Mexico Spanish Formatting and UX Copy

The public experience MUST use concise Mexico Spanish user-facing labels, actions, loading messages, empty-state guidance, error messages, and not-found messaging. It MUST use Mexico Spanish conventions for dates and currency and MUST use understandable labels for the supported job values, including `Remoto`, `Híbrido`, `Presencial`, and `Tiempo completo` where applicable.

Salary display MUST identify the supplied currency and show only available bounds. Dates MUST be formatted deterministically for the rendered request so the same data does not produce a hydration-dependent result.

#### Scenario: Vacancy metadata uses Mexico Spanish

- GIVEN a valid vacancy with work mode, employment type, seniority, salary, and publication date
- WHEN the vacancy is rendered
- THEN its visible labels and formatted metadata use Mexico Spanish conventions and clearly identify MXN or USD when salary is present

#### Scenario: Partial salary data is formatted honestly

- GIVEN a valid vacancy with only a minimum salary, only a maximum salary, or no salary bounds
- WHEN the vacancy is rendered
- THEN the page shows the available bound or omits salary entirely and never invents a range or currency value

#### Scenario: State copy is actionable Mexico Spanish

- GIVEN the list or detail route is loading, empty, unavailable, or not found
- WHEN the corresponding state is shown
- THEN its message and action are written in concise Mexico Spanish and explain the next available action

### Requirement: Complete List and Detail States

The list and detail routes MUST provide distinct, actionable loading, success, empty, API/transport/schema error, and not-found behavior appropriate to each route. Loading and pending feedback MUST match the surrounding content layout, expose an accessible status, and MUST NOT be required for the correctness of the final rendered page.

List errors MUST offer retry navigation without exposing internal transport or schema details. A list with no matching vacancies MUST explain that no results match and provide a clear way to remove filters. A detail `404` or malformed UUID-like `jobId` MUST use the branded not-found state with a link to `/vacantes`. Transport, server, and schema failures MUST remain error states and MUST NOT be presented as not found.

#### Scenario: List navigation exposes pending feedback

- GIVEN a visitor submits a search, filter, or next-results navigation
- WHEN the new list request is pending
- THEN the controls expose an accessible pending status and appropriate disabled or busy feedback while preserving the current page usability

#### Scenario: Empty filtered results offer reset

- GIVEN the jobs service returns a valid empty item array for the current filters
- WHEN the list page renders
- THEN it explains that no vacancies match and provides a clear action that returns to the unfiltered canonical list

#### Scenario: List service failure offers retry

- GIVEN the list service times out, returns a transport failure, a 5xx response, or an invalid schema
- WHEN the list route renders
- THEN it shows a concise Mexico Spanish error state with retry navigation and does not show fake vacancy rows

#### Scenario: Detail not-found is distinct from service failure

- GIVEN the detail service returns `404` or the requested `jobId` is malformed
- WHEN the detail route resolves
- THEN it renders the branded not-found state with a link to `/vacantes`

#### Scenario: Detail service failure remains retryable

- GIVEN the detail service times out, returns a 5xx response, or returns an invalid schema for an otherwise valid identifier
- WHEN the detail route resolves
- THEN it renders a retryable Mexico Spanish error state and does not misclassify the vacancy as not found

### Requirement: Accessible Responsive Vacancy Experience

The routes MUST use semantic headings, result/list and article structures, descriptive links, and real labels for every interactive control. Each route MUST have one clear `h1`. Keyboard focus MUST remain visible, tab order MUST be logical, and interactive targets MUST be touch-usable at approximately 44 CSS pixels where practical. Text and controls MUST meet WCAG AA contrast in both supported themes.

On viewports below 768px, filters MUST be presented through an accessible titled Sheet or equivalent mobile surface while essential search remains available without opening it. On wider viewports, filters MAY remain beside or above results. Titles, company names, locations, salary ranges, and descriptions MUST wrap safely without fixed-height content loss. Motion MUST NOT be required to understand or operate the experience and MUST honor reduced-motion preferences.

#### Scenario: Keyboard visitor can operate list filters

- GIVEN a visitor uses only a keyboard on the vacancy list
- WHEN the visitor focuses, changes, submits, or clears search and filters
- THEN every control has a visible focus indicator, a usable label, and a logical keyboard order

#### Scenario: Mobile visitor opens titled filters

- GIVEN a visitor views `/vacantes` below the 768px responsive threshold
- WHEN the visitor opens the filters surface
- THEN the surface has an accessible title, exposes labeled scalar controls, keeps essential search available outside it, and can be closed using keyboard interaction

#### Scenario: Long vacancy content remains readable

- GIVEN a vacancy has a long title, company name, location, salary range, or multi-paragraph description
- WHEN it is rendered on a narrow or wide viewport
- THEN the content wraps without clipping, overlap, horizontal page overflow, or fixed-height truncation

#### Scenario: Reduced-motion visitor receives equivalent functionality

- GIVEN the visitor has enabled a reduced-motion preference
- WHEN list or detail content loads or navigation feedback changes
- THEN all required content and state transitions remain usable without nonessential motion

### Requirement: Fresh Non-Streaming Server Rendering

The initial list and detail response MUST be complete and derived from the current validated API response at request time, without requiring browser-direct API access, streamed HTML, or an ISR invalidation event. A production build MUST NOT require the jobs API to be available during the build. A later request MUST be able to reflect current public visibility, including newly published or no-longer-visible vacancies.

Client-initiated navigation MAY show pending feedback, but the final correctness of list, detail, empty, error, and not-found states MUST remain correct if the hosting platform buffers the response and does not stream it.

#### Scenario: Build succeeds while the API is unavailable

- GIVEN the jobs API is unavailable during the production build
- WHEN the frontend production build runs
- THEN the build completes without needing to fetch vacancy data at build time

#### Scenario: Request-time visibility is fresh

- GIVEN a vacancy's public visibility has changed in the jobs API after an earlier page request
- WHEN an anonymous visitor makes a new list or detail request
- THEN the rendered result reflects the API's current visibility rather than requiring an ISR revalidation event

#### Scenario: Buffered responses remain correct

- GIVEN the hosting runtime buffers a server response instead of streaming it
- WHEN an anonymous visitor loads the list or detail route
- THEN the visitor receives the correct completed success, empty, error, or not-found state without relying on streamed fallback content

### Requirement: Frontend Verification Coverage

The change MUST establish frontend-local verification for the public job discovery capability without changing backend verification commands or shared project configuration. Verification MUST cover URL parsing and canonicalization, supported currency and cursor rules, formatting, response validation, list/detail state mapping, omitted optional fields, responsive filter accessibility, browser history, visible focus, and production readiness through type checking, linting, tests, build, and an accessibility check.

#### Scenario: Frontend checks cover the agreed behavior

- GIVEN the frontend verification suite runs from the standalone frontend project
- WHEN the checks execute
- THEN they exercise success, omitted optional fields, empty results, malformed data, transport and 5xx failures, detail `404`, malformed identifiers, currency canonicalization, cursor reset/preservation, responsive filters, and browser back/forward behavior

#### Scenario: Backend verification remains unchanged

- GIVEN the frontend verification setup is added
- WHEN frontend tooling and checks are configured
- THEN backend commands, backend feature behavior, shared root configuration, and the canonical `jobs` specification remain unchanged
