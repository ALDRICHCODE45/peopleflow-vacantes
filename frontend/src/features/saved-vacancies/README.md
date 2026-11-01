# Saved vacancies — T2

Covers S2 (listing/detail controls), S5 (candidate-only saving) and S6 (confirmed results, retry and undo). The saved workspace belongs to T4; visitor return intent belongs to T3.

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

`SavedJobControl` accepts `onVisitorSaveT3(jobId, returnTo)`. It receives the current internal path including filters. Until T3 implements the prompt and auto-save intent, the fallback uses `candidateAuthHref("login", returnTo)`. Neither visitor nor company sessions call the saved API. Loading reserves the control's dimensions without exposing private state.

## UI composition

The listing and detail stay server components, passing the existing navigation/apply action as server-rendered children to the island. No save control appears in draft previews. Legacy jobs remain saveable without inventing an application endpoint.

The installed Button's icon example and Spinner's button example are followed (`docs/design/shadcn-reference/button.md`, `spinner.md`). The requested 40/48px targets extend the installed icon size. Direction 03 explicitly joins the detail pair and reserves its status below; the listing uses the standard ActionBar, with its reserved status to the left. Other aside content is unchanged.

Success: “Vacante guardada” with “Ver guardadas”. Removal: “Quitaste la vacante” with “Deshacer” (a new PUT). Errors use reviewed Mexican Spanish, persistent error toasts with a sanitized reference/time, and retry/session actions also available outside the toast. IDs-read failures disable the toggle and offer a read-only retry rather than treating failure as an empty list.

Real-backend integration and browser checks (mobile, dark mode and long text) remain for T5/the parent; unit tests use mocked HTTP.
