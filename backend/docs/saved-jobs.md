# Candidate saved jobs

Candidates can privately save up to **200** public vacancies or legacy jobs.
All routes use `NoStore → RequireAuth → RequireCandidateRole`, the same live-role
gates as `/v2/me/cvs`. Every response, including authentication failures, has
`Cache-Control: no-store`. Anonymous requests return 401; recruiters return
`403 wrong_role`; identities without an account return `403 account_required`.
There is no employer-facing saved count or list.

## API

`jobId` is the UUID used by `/v2/jobs/{id}`, unchanged for either catalog source.
PUT needs no body. Times are UTC RFC3339.

| Method | Path | Success |
| --- | --- | --- |
| PUT | `/v2/me/saved-jobs/{jobId}` | 201 on creation, 200 on replay; `{job_id,saved_at}` |
| DELETE | `/v2/me/saved-jobs/{jobId}` | 204, empty body, even when not saved |
| DELETE | `/v2/me/saved-jobs?availability=closed` | 200 `{removed:3}` |
| GET | `/v2/me/saved-jobs` | 200 `{items,total,limit:200}` |
| GET | `/v2/me/saved-jobs/ids` | 200 `{job_ids:[uuid,...]}` |

Lists include every saved row (no pagination), ordered by `saved_at DESC`, then
`job_id ASC`. Empty collections are arrays, not null. Each item contains exactly
`job_id`, `saved_at`, `availability`, `closed_at`, `application`, and `job`.
The `job` snapshot has the same values as the public catalog for these keys:
`source`, `title`, `company` (`id,name,logo_url`), `location_label`, `work_mode`,
`compensation`, `legacy_salary`, `published_at`. Legacy compensation is null;
legacy salary uses the public catalog's two-decimal strings.

### Saving and limits

PUT evaluates in this order:

1. An existing saved row returns 200 and its original `saved_at`, even if closed
   or the candidate has 200 saved rows.
2. Unknown/malformed IDs, drafts, inactive/deleted companies and unpublished or
   soft-deleted legacy jobs return `404 not_found`.
3. A paused or closed vacancy returns `409 job_unavailable`.
4. A candidate with 200 saved rows returns `409 saved_jobs_limit`.
5. Otherwise insert and return 201.

The cap counts open and closed rows. A candidate `users` row `FOR UPDATE` lock
serializes count and insert in one transaction (the existing CV-library locking
convention). Two concurrent saves at 199 cannot produce 201 rows. Removal followed
by a new PUT creates a new `saved_at`; replay never updates it.

### Availability and applications

Availability is resolved on read, not stored on the bookmark:

| Source | Open when | Closed timestamp |
| --- | --- | --- |
| Vacancy | Process published and company active/not deleted | `closed_at` for closed, `paused_at` for paused, otherwise null; inactive/deleted company always null |
| Legacy | Job published/not soft-deleted and company active/not deleted | Job `deleted_at` when soft-deleted, otherwise null |

Resuming a paused vacancy makes its bookmark open again. Closed rows retain their
snapshot. `application` is `{id,applied_at}` from the candidate's
`process_participations` row (`created_at`), or null; legacy always returns null.

Bulk DELETE uses the same availability rule in one statement and returns the
number removed. Its query must have exactly one key `availability`, once, with
value `closed`. Missing, extra, repeated, or malformed query parameters fail
before any store write.

## Errors

| Code | HTTP | Message / additional fields |
| --- | --- | --- |
| `not_found` | 404 | `not found`; malformed DELETE IDs also use this |
| `job_unavailable` | 409 | `job unavailable` |
| `saved_jobs_limit` | 409 | `saved jobs limit reached`, `data:{limit:200}` |
| `validation_error` | 400 | `validation failed`, `fields:[{field:"availability",code:"invalid"}]` |

Other errors use the existing normalized HTTP error catalog. Database details
are never returned.

## Storage and verification

Migration **00053** stores one row per candidate/public job, with exactly one
source foreign key and generated `job_id`. Hard deletion of either source
cascades to bookmarks. Down migration refuses while saved data exists. No file
storage configuration is needed.

| Test | Specs |
| --- | --- |
| `TestSaveEvaluationOrderAndRejections` | S2–S3: visibility, replay precedence, cap, rejection leaves list unchanged |
| `TestConcurrentSavesAt199` | S3: concurrent cap enforcement |
| `TestSnapshotsAvailabilityOrderingIsolationAndRemoval` | S4–S7, S9: public snapshot parity for both sources, ordering, IDs, candidate isolation, availability/resume, bulk count |
| `TestApplicationsAndHardDeleteCascade` | S8: participation identity/time, legacy null, both source cascades |
| `TestSavedJobsHTTP`, `TestSavedJobsRejectedTransportNeverWrites` | S1–S6, S9: exact response bodies/status, no-store, input rejection before writes |
| `TestSavedJobCatalogAndLimitData` | S2: catalog resolution and fixed limit envelope |
| `TestP2bPrivateRoutesLiveCandidateGates`, `TestSavedJobsStaticIDsRoute`, `TestRouteTopology_ExactRegistrations` | S1, S9: route registration, static IDs dispatch, candidate-only gates |

Integration tests require loopback `draft_test` via `DRAFT_TEST_DATABASE_URL`;
without it they explicitly skip, which is not database evidence. Fixtures apply
embedded migrations to the existing isolated database and clean their own rows.
