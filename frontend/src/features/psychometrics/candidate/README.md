# Public assessment — T10

Covers S4 (answer events and visible time), S11 (account-free, mobile, saved progress) and S12 (backend notice and explicit consent). The account workspace is T11, not this implementation. No scores are sent to or shown by this surface.

## Route integration (L29)

`app/(public)/evaluacion/[token]/route.ts` exchanges the link for an httpOnly session cookie and returns 303 to `/evaluacion`. It checks only base64url shape and length (32–128 characters; the proposed 256-bit token is 43), never calls the backend, and sets `Cache-Control: no-store` and `Referrer-Policy: no-referrer` on both accepted and malformed links. Shape acceptance is not assessment authorization; the backend still checks expiry/revocation on every request.

The cookie `pf_assessment` has Path `/evaluacion`, SameSite=Lax, HttpOnly, Secure in production, and no Max-Age/Expires. One assessment per browser at a time: the last well-shaped link wins. A malformed link does not set **or clear** a cookie: an accidental bad link must not log a candidate out of an existing assessment. It redirects to that assessment if one exists, otherwise the identical neutral unavailable screen.

`app/(public)/evaluacion/page.tsx` is the only page and has a static path. It directly calls the server-only `AssessmentPage()` function, which reads the cookie without passing a token through any React component props. Missing cookie returns the same unavailable state without a backend call. Metadata remains noindex/nofollow/no-referrer; literal route exports force dynamic rendering, zero revalidation and no-store fetching. The old dynamic page and its test must be removed when integrating: Next cannot have a page and handler at the same segment.

Route tests cover cookie attributes, redirects/headers, malformed links, missing/present cookies, prop containment, the filesystem boundary and Next's real `createFlightRouterStateFromLoaderTree` probe over the static loader tree. The feature tests use the real T6 client and mocked backend HTTP responses, including visibilitychange and pagehide/pageshow timing. Next compilation, actual RSC encryption and browser/layout QA remain integration checks, not claims made by jsdom tests.

`(public)/layout.tsx` returns children without app chrome or auth. The root layout adds theme/toast infrastructure, not a session gate. `middleware.ts` matches only vacancy paths, not `/evaluacion/…`. Do not add this route to an auth allowlist. Dynamic segment options must remain literal exports in the route.

## Token inventory / security boundary

1. Incoming `/evaluacion/[token]` GET handler parameter (already in the incoming link). This segment is never a page/Flight loader-tree segment. The 303 target is the static `/evaluacion`, with no token or query string. The incoming link may still remain in external delivery systems, request logs and browser history; redirecting is not a guarantee of erasing it.
2. `pf_assessment` httpOnly session cookie, restricted to `/evaluacion`, and server-only `AssessmentPage()` / `load(token)` memory. The cookie is browser-held bearer state but inaccessible to JavaScript. No token is passed as a React prop, rendered in HTML, or serialized in the static page's Flight router state.
3. Inline Server Action closures capturing `token`. Next encrypts closure captures; do not substitute `.bind(token)`, client props, hidden inputs, action URLs or client storage.
4. T6 client's `{ access: "public", assessmentToken: token }` input, validation and configured-origin backend URL `/v2/assessments/{token}` with the required endpoint suffix. This is the existing contracted public transport, never a browser-side fetch or redirect.
5. The same encrypted closure is returned to the current page for subsequent action POSTs. Client arguments contain only position, notice version/hash or answer event bodies, never the token. No additional browser URL is composed.

There are no console calls, analytics calls, exception messages containing inputs, account-session reads or external links. The only redirect is the local token-free 303 exchange. Cookies are scoped to `/evaluacion`; Server Actions retain encrypted captures rather than relying on a cookie attached to an unrelated path. Failure displays use known local copy, never backend error text. Metadata is static (`noindex, nofollow`, `no-referrer`); backend fetches use T6's `no-store`, omitted credentials and no-referrer. Public-route request/access/error logs at Next, hosting, proxy and analytics infrastructure must also redact this path; application code cannot configure those services from this edit surface. Verify that policy before launch.

## Response semantics

- Consent shows the exact backend text as plain text with preserved line breaks; its version/hash alone are posted. A changed notice is reloaded and the checkbox resets. Items are not fetched before consent.
- Selecting an option immediately saves it. Previous/next saves a new same-value event before leaving an answered item, including on a revisit. Clear sends DELETE with only a fresh UUID. Actions are serialized; a failed write leaves the confirmed local and backend answer unchanged and disables competing edits until explicit retry.
- A retry captures the same body (UUID, value and elapsed time) for uncertain PUT/DELETE outcomes. No automatic retries, no per-render events. Transient errors retain a persistent ActionStatus and use the shared toast helper. Successful per-option autosaves use the confirmed selected option/progress rather than a toast per keystroke; errors never rely on transient feedback alone.
- A monotonic per-item clock pauses on hidden tabs, pagehide, item navigation and unmount, resuming on visibility/pageshow. No visible timer or time limit. It sums intervals across in-memory revisits and caps optional telemetry at the contract limit.
- GET items contains no historical elapsed milliseconds. For answers already saved when this session begins, omit optional timing instead of overwriting the server total with a shorter partial visit. This is deliberately incomplete telemetry, not an invented historical total; cumulative timing cannot be reconstructed across reloads without a future backend field. No answer/token is persisted in browser storage.
- All answered enables finish. Incomplete responses reload the authoritative answers and select the minimum missing position. Closed/expired/revoked/unknown writes show the same neutral StateCard. Retry-After accepts seconds or HTTP date through the T6 client; the UI displays seconds, never raw error text.

## shadcn composition audit

Official snapshots read from `docs/design/shadcn-reference/` before implementation:

| Surface | Official reference / composition | Adaptation |
| --- | --- | --- |
| Notice | card.md: Card → Header (Title, Description) → Content | Real heading; backend notice text; no redundant footer |
| Consent | checkbox.md Basic, field.md horizontal Field + Checkbox + FieldLabel | Explicit controlled checkbox; >=40px label target |
| Answers | radio-group.md Choice Card + Fieldset; field.md Choice Card | FieldSet/Legend/Description/Group → RadioGroup → FieldLabel → horizontal Field → RadioGroupItem + FieldContent/FieldTitle |
| Progress | progress.md Basic | Real answered count/max; label outside the native track |
| Navigation | button.md Outline/Default; spinner.md Button | Minimum target size required by approved mobile artboard; native geometry otherwise |
| Terminal/error states | empty.md empty-demo via existing StateCard | Identical neutral unavailable state; final content and company/vacancy from backend |
| Pending operations | spinner.md Button | Real pending work only; initial content loaded server-side, so no invented skeleton |

Validated references: `design/psychometric-flows/02-candidato-consentimiento.html`, `03-candidato-preguntas.html`, `04-candidato-final.html`. The artboard state switcher is preview-only and not shipped. Added clear/finalize/retry controls are required functional states. No `review` tone, raw colors or manual dark-mode colors.

Pending parent QA: compare at 390px and desktop, light/dark, long notice and names, selected/focused/disabled options, keyboard navigation, all terminal states, and compiled RSC payload/token handling. The allowed runner here is Vitest/TypeScript/ESLint, not a browser or production build.
