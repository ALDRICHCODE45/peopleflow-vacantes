# Saved vacancies — T2 / T3

Covers S2 (listing/detail controls), S5 (candidate-only saving) and S6 (confirmed results, retry and undo). The saved workspace belongs to T4. T3 adds the visitor prompt and return intent (S3, preserving S5/S6).

## T4 API

Browser callers import the async functions in `actions.ts`:

- `loadSavedJobsAction()` → `SavedJobsResult<SavedJobs>`
- `loadSavedJobIdsAction()` → `SavedJobsResult<SavedJobIds>`
- `saveJobAction(jobId)` → `SavedJobsResult<SavedJob>`
- `removeSavedJobAction(jobId)` → `SavedJobsResult<null>`
- `removeClosedSavedJobsAction()` → `SavedJobsResult<{ removed: number }>`

`client.ts` exports corresponding server-only functions without `Action`, accepting `{ token }` and, for single-job writes, `{ token, id }`. Like candidate CVs, actions resolve the existing session with `getActionAccessToken`; credentials never enter the browser. The transport rejects redirects, validates endpoint suffixes, disables caching and bounds response bodies and time.

`model.ts` exports the Zod decoders and public result types. Snapshots reuse the public catalog's salary/compensation schemas. List order is preserved (`saved_at DESC`, then `job_id ASC`). Validation errors decode the shared `fields` envelope, not `data`; only `saved_jobs_limit` decodes `data.limit: 200`. Raw backend messages are never returned to the UI.

`queries.ts` exports `savedJobIdsKey`, `savedJobsKey`, `savedJobsQueryClient(identity)` and `updateSavedJobIds(client, jobId, saved)`. Use that same identity-scoped client in T4. The existing identity boundary remounts on account changes; caches are weakly keyed by the resolved identity, not shared between candidates. IDs are read once per resolved identity, not once per card. Confirmed single-job writes update IDs and invalidate the list. Bulk removal should reconcile IDs with a fresh read after confirmation; do not infer removed IDs from a stale availability snapshot.

## T3 seam

`SavedJobControl` accepts the optional host override `onVisitorSaveT3(jobId, returnTo)`, with the current internal path including filters. Without an override it opens the installed Popover (official Basic composition: trigger → content → header/title/description), with candidate registration/login links built by `candidateAuthHref`. The links preserve filters and replace `guardar` with the job ID.

`SavedJobReturnIntent` mounts once before the listing navigation island and once from the detail control (`placement="detail"`), never per listing card. The listing excludes `guardar` from filter canonicalization and carries it through redirects without changing the public filter grammar. A module-level in-flight set keyed by job ID lets only one resolved instance execute, including StrictMode replays. A valid single UUID and a resolved candidate trigger one PUT through the existing candidate mutation and feedback. The URL retains `guardar` until that request settles; only then does the consumer clean native history and call `router.replace`, without adding history or scrolling. It preserves other query parameters and the hash, and does not clear a different/newer navigation. A reload while pending retains the intent and can replay the backend's idempotent PUT (an already-saved 200 is normal success), so the save is not lost. After settlement, refresh has no intent to replay. Duplicate/malformed parameters, visitors and company accounts only clear the intent; loading waits. The consumer can save an off-page job. No persistent browser storage or candidate state is added.

Per-card controls never read Next router hooks: visitor return URLs are captured from the live location when opening the prompt; event-only navigation uses `navigateSavedJob`. Without an identity provider, the existing identity default renders a dimensioned placeholder; candidate islands explicitly pass their identity-scoped QueryClient to every query/mutation hook and require no QueryClientProvider. The return consumer waits for resolved identity before mounting its router-dependent child.

Neither visitor nor company sessions call the saved API. Loading reserves the control's dimensions without exposing private state. The return consumer reuses the candidate mutation, ID writer, error copy, retry and confirmed-success notification. It renders a dedicated reserved result slot by the consuming island; browser layout checks remain pending.

T3's full `save-control.test.tsx` passes with 25 tests. Following §13.7 and `psychometrics/profile/help.test.tsx`, tests use real timers, `fireEvent`, ordinary `render`/`screen`/`waitFor`, no custom portal container, and replace only the anchored popup shell. The real Base UI Root, Trigger, Title and Description remain. The positioner loops in jsdom, even with anchor tracking/collision handling disabled; replacing that shell removes the hang. Content, auth hrefs, official composition and trigger toggling are covered. Escape, outside-click dismissal, focus return and actual anchoring remain browser checks, not claims made by the shell double. Auth links follow the Button “As Link” example (`Link` + `buttonVariants`, not Base UI Button rendering an anchor).

## UI composition

The listing and detail stay server components, passing the existing navigation/apply action as server-rendered children to the island. No save control appears in draft previews. Legacy jobs remain saveable without inventing an application endpoint.

The installed Button's icon example and Spinner's button example are followed (`docs/design/shadcn-reference/button.md`, `spinner.md`). The requested 40/48px targets extend the installed icon size. Direction 03 explicitly joins the detail pair and reserves its status below; the listing uses the standard ActionBar, with its reserved status to the left. Other aside content is unchanged.

Success: “Vacante guardada” with “Ver guardadas”. Removal: “Quitaste la vacante” with “Deshacer” (a new PUT). Errors use reviewed Mexican Spanish, persistent error toasts with a sanitized reference/time, and retry/session actions also available outside the toast. IDs-read failures disable the toggle and offer a read-only retry rather than treating failure as an empty list.

## T5 real-response contract checks

`fixtures/real-responses.json` contains unmodified response bodies captured with curl from the real backend at `2eed86a0` (branch tip `c1d8f267` adds documentation), using a disposable PostgreSQL database and locally generated PEM authentication. IDs, company names and job titles were synthetic at insertion time; no user credentials or data are included. Captures retain the request method/path/status, bodyless 204, error envelopes, both salary representations, application identity, paused/closed timestamps and backend ordering.

`real-responses.test.ts` validates these bodies through both `model.ts` and the public client result mapping. Its optional live probe exercises all five client functions against `127.0.0.1:8599`, enabled only by `SAVED_JOBS_LIVE_TOKEN` containing a throwaway local candidate token. It expects the disposable fixture at 200 saves with the synthetic IDs from the captures; it removes and re-saves the legacy row. It mocks only server environment configuration, never the live fetch or the application session boundary. Ordinary test runs replay captures without services, credentials or `.env` loading.

Browser checks (mobile, dark mode, visitor sign-in, toast interaction and long text) remain with the parent/user; API/decoder verification does not establish visual or browser acceptance.
