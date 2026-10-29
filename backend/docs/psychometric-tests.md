# Vacancy psychometric profile (B3)

Employers can save a private, vacancy-scoped profile for `ipip60-mx`.
This slice configures requirements only: it does not create invitations, collect
answers, score candidates or move/reject anyone. The authoritative wire contract
is [psychometric-tests-v1](../../docs/contracts/psychometric-tests-v1.md).

## Read, edit, save

1. `GET /v2/me/company/job-drafts/{id}/psychometric-profile` returns `200`
   with the profile and a strong, opaque, hashed `ETag` (`"pp1-…"`).
2. Send a full replacement with `PUT` to the same path and that exact tag in
   `If-Match`. Omit the server-owned `version` and `confirmed_at` keys.
3. Use the returned `200` profile and ETag for the next edit. A stale tag is
   `412 version_conflict`; refetch before retrying. Identical normalized saves
   change neither the version nor the audit log (including unsaved defaults).

Every response is `Cache-Control: no-store`. Both routes use the checklist's
recruiter membership and owner-or-principal gates: foreign, unknown and
non-principal vacancies are `404`. Draft, published, paused and closed-but-ongoing
processes remain editable; a finished process rejects PUT with
`409 process_finished`, while GET remains available.

## Profile fields

| Field | Behavior |
| --- | --- |
| `version` | Server decimal counter, `"0"` before any changed save; independent of draft/pipeline versions. |
| `enabled` | Boolean, default false; independent of confirmation. |
| `test` | Only `ipip60-mx`. |
| `confirmed` | Writable boolean, default false. |
| `confirmed_at` | Server RFC 3339 timestamp, null while unconfirmed. |
| `competencies` | Exactly one entry per each of the seven embedded catalog IDs, including `comp.presion`. Defaults follow catalog order. |
| `auto_send_stage_ids` | Array of distinct current progression-stage IDs of this vacancy's pipeline; exit/retired/foreign/unknown stages are invalid. Default `[]`. GET silently hides stages no longer current, without rewriting storage/version. No auto-send runs in B3. |
| `expires_in_days` | Integer 1–30 inclusive, default 7. |

Each competency entry has exactly `competency_id`, `importance`, `desired_band`,
`rationale` and `task`. Importance is `importance.clave`, `importance.importante`
or `importance.no_relevante`. No relevante requires null `desired_band`,
`rationale` and `task`, even in drafts; any non-null value yields that field's
`not_allowed` error. Never-saved defaults use these three nulls. Clave and
Importante require `band.low`, `band.medium` or `band.high`.

Text is trimmed and counted as Unicode characters. Rationale is at most 1000
characters and a Clave task at most 300. Clave/Importante rationale must always
be a string: `""` is allowed while drafting; null is `invalid` in drafts and on
confirmation. Confirmation requires 1–1000 characters after trim (`required`
for an empty or whitespace-only string).
Only Clave accepts a task: null/empty is allowed while drafting, but confirmation
requires 1–300 trimmed characters. Importante, like No relevante, requires null
task in every state; non-null is `not_allowed`. Confirming an all-No-relevante
profile needs no rationale or task.
A save with `confirmed: false` clears `confirmed_at`, including when requirements
change. Explicit `confirmed: true` confirms changed requirements at server time;
identical confirmed saves retain their timestamp. Non-requirement edits preserve
that timestamp when `confirmed` remains true.

## Errors and audit

- Missing `If-Match`: `428 precondition_required`.
- Empty, malformed, weak, wildcard, repeated or list tag: `400 invalid_request`.
- Well-formed mismatching tag: `412 version_conflict`.
- Invalid profile: `400 validation_error`, `fields[]` with `field` and one of
  `required`, `invalid`, `too_long`, `duplicate`, `not_allowed`. Stage errors use
  `auto_send_stage_ids[k]`. Unknown keys, including server-owned keys, are
  `not_allowed`; malformed JSON and duplicate JSON keys are `invalid_request`.

Changed replacements co-write `JobDraftPsychometricProfileConfigured` on the
`job_draft` entity, with `version` and complete JSON-string `previous`/`new`
snapshots, in the same transaction. Rejected saves and no-ops write nothing.
The shared parent lock serializes profile saves with pipeline and lifecycle
changes. Migration `00049` creates only `job_draft_psychometric_profiles`, linked
to the company-scoped draft; its Down refuses to remove retained profiles.

## Verification

From `backend/`:

```sh
go test -count=1 ./internal/features/psychometrics/...
go test ./cmd/api -run '^(TestPsychometricProfileRoutes|TestRouteTopology_ExactRegistrations)$' -count=1
go test -tags integration ./cmd/api -run '^(TestPsychometricProfile|TestChecklistFlow)' -count=1
go test -tags integration ./db/migrations -run '^TestPsychometricProfileMigrationGuardedDown$' -count=1
go vet ./...
go run ./cmd/archguard
```

Integration tests reuse the checklist harness. Set `DRAFT_TEST_DATABASE_URL` to
a dedicated **loopback** database named **draft_test**; never the development DB.
The harness refuses other hosts/database names, never reads ambient
`DATABASE_URL`, migrates only the isolated DB and cleans up its fixtures. With no
dedicated DSN it skips; a skip is not database verification. Archguard's existing
`docker/minio/Dockerfile` locked-non-goal failure is unrelated to B3. On macOS's
bash 3.2, the pre-existing `scripts/closure/gate:44` command-substitution/case
syntax also breaks closure receipt tests in the full suite; it is not a profile
failure.
