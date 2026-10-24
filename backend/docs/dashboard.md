# Employer dashboard API (v2)

Read-only aggregate for the employer dashboard. Feature record:
`odd/tasks/employer-real-data.md`, S1a–S1d.

## Route

| Method | Route | Success |
| --- | --- | --- |
| `GET` | `/v2/me/company/dashboard` | `200 OK` |

Requires the same access-token and company owner/recruiter gates as
[the draft list](draft-list.md). Company and actor come only from the session.
All responses, including authentication failures, carry `Cache-Control: no-store`.
No query parameters are required. The endpoint performs no writes, materializes
no default configuration and changes no schema.

## Visibility and consistency

The draft list and dashboard share the same SQL visibility predicate: owners
see all company schema-2 drafts; recruiters see only their principal vacancies.
Other companies and schema-1 drafts never contribute. Live user, company and
membership gates are rechecked in the operation transaction. All database reads,
including the pool summary, share a repeatable-read snapshot.

## Response

The top-level contract has exactly these six fields:

```json
{
  "published_vacancies": 2,
  "in_process": 5,
  "pool_added_last_7_days": 3,
  "positions": { "covered": 1, "required": 4 },
  "origin_by_day": [
    { "date": "2026-07-26", "organic": 0, "manual": 0 },
    { "date": "2026-07-27", "organic": 1, "manual": 0 }
  ],
  "recent": [
    {
      "participation_id": "0192a000-0000-7000-8000-000000000005",
      "candidate": {
        "kind": "organic",
        "id": "0192a000-0000-7000-8000-000000000006",
        "name": "Ana Pérez",
        "professional_title": "Ingeniera de plataforma"
      },
      "vacancy": {
        "id": "0192a000-0000-7000-8000-000000000003",
        "title": "Backend Go"
      },
      "stage": {
        "id": "0192a000-0000-7000-8000-000000000007",
        "name": "Screening",
        "kind": "screening"
      },
      "source": "organic",
      "applied_at": "2026-10-23T12:30:45.123456Z",
      "added_by": null
    }
  ]
}
```

The example abbreviates `origin_by_day`: actual responses **always contain 90
consecutive entries**, oldest first, ending today in `America/Mexico_City`.
Clients can take the last 7, 30 or 90 entries without another request.

| Field | Definition |
| --- | --- |
| `published_vacancies` | Visible vacancies whose publication status is `published`. Draft, paused and closed vacancies do not contribute. |
| `in_process` | Sum of the draft list's `candidates.in_process` over visible published vacancies: active (not discarded) participations in current progression stages other than semantic `new`, including placement. |
| `pool_added_last_7_days` | Exactly the company candidates summary's `added_last_7_days`. This is company-wide, not restricted to principal vacancies; it counts pool identities, not participations. It uses the existing PostgreSQL seven-day window. |
| `positions.covered` | Sum of board placement coverage over visible published vacancies: participations currently in the semantic placement stage, not historical milestones or delivery counts. |
| `positions.required` | Sum of board required hiring headcounts over visible published vacancies; an unset headcount contributes zero. |
| `origin_by_day` | Participation entries in **all** visible vacancies, regardless of current publication status or discard state. `organic`/`manual` count participation `source`, independently of candidate identity kind. Dates use entry time (`created_at`, exposed by the board as `applied_at`), not stage movement time. Missing days contain integer zeroes. |
| `recent` | At most 10 participations in all visible vacancies, ordered by entry time descending, then participation UUID descending to break ties. Empty is `[]`, never `null`. |

A recent row's `candidate.kind` is `organic` (user identity) or `manual`
(company-private identity); `candidate.id` belongs to that identity namespace.
The name includes company corrections, like the board. `candidate.professional_title`
is a string or explicit `null`: company-private identities use their company record;
organic identities use the current candidate profile with company corrections (including
explicit null) taking precedence. No contact data is added to this projection. Participation `source`
is separately `organic` or `manual`: a recruiter can manually add an organic
identity. `added_by` is `{ "id": "UUID", "name": "Recruiter name" }` for manual
entries and `null` for organic entries. `applied_at` is RFC3339 UTC. Stage names
use the current pipeline configuration (including the exit and retired stages).
`stage.kind` preserves the configuration's semantic kind independently of its label:
`new`, `screening`, `screening_ok`, `in_process`, `placement`, `discarded`, or `custom`.
Clients may use it for badge tones without interpreting renamed Spanish labels. Vacancy IDs
open the existing vacancy board route.

An empty company returns zero for every card and position field, 90 zero-filled
days, and `recent: []`. No trend arrows or trend formulas are provided.

## Errors

The existing draft error envelope is unchanged:

```json
{ "error": "unauthenticated", "code": "unauthenticated" }
```

Authentication and role failures use the same `401 unauthenticated` and
`403 forbidden` gates as the draft list. Transactional live-gate failures use
the same draft error mapping. Unexpected errors return sanitized
`500 internal_error`; database details are never returned.

## Validation

From `backend/`:

```sh
go test ./internal/features/jobs/application/dashboard ./cmd/api -run 'TestService|TestDashboard'
go test -tags=integration ./internal/features/jobs/infrastructure/postgres/draftstore -run '^TestDashboard' -v
go vet ./...
go test ./...
```

PostgreSQL tests use the existing isolated draft fixture. They skip when
`DRAFT_TEST_DATABASE_URL` is absent and refuse non-loopback hosts or any database
not named `draft_test`. They exercise visibility, publication filtering, source
splits, the Mexico City midnight boundary, recent ordering/cap, placement counts
and equality with the company pool summary. Use only a dedicated disposable
instance: the existing fixture applies embedded migrations and cleans its data.
