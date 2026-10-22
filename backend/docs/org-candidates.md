# Org candidates API — «Candidatos de mi organización» v1 (DRAFT)

Status: **draft for frontend review**, not implemented. Feature document:
`odd/tasks/org-candidates.md`. Business rules: SRCH-2/3/4/7 in
`docs/recruitment-business-rules.md` §12.

## Scope and access

- Routes: `GET /v2/me/company/candidates` (list) and
  `GET /v2/me/company/candidates/{kind}/{id}` (detail), plus
  `GET /v2/me/company/candidates/{kind}/{id}/participations/{participationId}/cv`.
- Gates: `NoStore → RequireAuth → requireRecruiter`. **Every recruiter of the
  company sees the whole pool** (user decision); no owner-or-principal check,
  unlike the board. Another company's candidate, or an unknown one, is 404.
- Pool = union of:
  - **manual** — every `company_candidates` record of the company;
  - **organic** — every user with at least one participation in a vacancy process
    of the company, whatever its source (organic application or manual reuse),
    stage or discard state, with or without a candidate profile row.
- Identity is `(kind, id)`: `kind` is `manual` (id = company candidate UUID) or
  `organic` (id = user UUID). The same real person may appear once per kind;
  v1 never merges them (duplicates stay advisory, as in manual intake).
- Nothing here leaves the company (SRCH-7). Read-only: no edits in v1
  (audited internal edits are cut 2, SRCH-4).

## Profile source

The six-key `profile` is the board's exact shape
([board-filter-data.md](board-filter-data.md)).

- manual → read live from the company record (as the board does);
- organic → the **frozen snapshot of the candidate's most recent participation
  in this company** (latest `entered_at`, then participation id). The live
  candidate profile is never read, so the pool only shows what the candidate
  shared with this company when applying (or what the recruiter captured on reuse).

## List

`GET /v2/me/company/candidates?<filters>&limit=20&cursor=…`

```json
{"items":[{
   "kind":"organic","id":"3f0c…",
   "full_name":"Mariana Ortega Silva",
   "profile":{"location":{…},"skills":["Go"],"years_of_experience":"4.5","seniority":"senior",
              "education":{"highest_completed":"bachelor","in_progress":"master"},
              "languages":[{"code":"en","level":"C1"}]},
   "participations":{"total":2,"active":1},
   "latest_participation":{"vacancy":{"id":"…","title":"Backend Go"},
                           "stage":{"id":"…","name":"Entrevista"},
                           "state":"active","entered_at":"2026-10-21T18:02:11Z"},
   "last_activity_at":"2026-10-21T18:02:11Z"}],
 "total":37,
 "next_cursor":"…"|null}
```

- No contact (email/phone) in list items, as on the board; contact is detail-only.
- `latest_participation` is null for a manual record with no participation.
- Order: `last_activity_at DESC, kind, id` (most recent first). `last_activity_at` =
  latest participation `entered_at`, or the manual record's `created_at` when it
  has none.
- `total` = exact count of the filtered pool (independent of the cursor).
- `limit` 1–50, default 20. `next_cursor` is opaque, bound to the normalized
  filters; reusing it with other filters is `invalid_cursor`.

### Filters

OR within a repeatable key, AND across keys; same matching rules as the board's
client-side filters (board-filter-data.md, «Client-side filters»), now applied
server-side over the whole pool. `none` selects missing values («Sin dato»).

| Key | Values |
| --- | --- |
| `q` | text 1–100 code points; case-insensitive substring of full name or email |
| `origin` | `manual` \| `organic` (one) |
| `vacancy` | repeatable vacancy (job-draft) id: candidates with a participation in any of them |
| `state` | repeatable MX state id or `none` |
| `municipality` | repeatable municipality id or `none` |
| `seniority` | repeatable literal or `none` |
| `years` | repeatable `0_1`, `1_3`, `3_5`, `5_plus`, `none` (decimal-aware `[0,1)`…`[5,∞)`) |
| `language` + `language_min_level` | repeatable code (or `none`); optional level `A1`…`C2`, `native` applied to the selected codes |
| `education_level` + `education_in_progress` | one minimum level; `education_in_progress=true` also matches `in_progress ≥ level` |

Errors: 400 `invalid_filter` `{field, code}` (unknown key, bad value, duplicate
one-valued key, `language_min_level` without `language`, `education_in_progress`
without `education_level`, vacancy not in the company); 400 `invalid_cursor`.

## Detail

`GET /v2/me/company/candidates/{kind}/{id}`

```json
{"kind":"manual","id":"…","full_name":"Lucía Ramírez Torres",
 "contact":{"email":"lucia@example.com","phone":"+523312345678"},
 "profile":{…six keys…},
 "participations":[{
    "id":"…","vacancy":{"id":"…","title":"Backend Go","lifecycle_state":"published"},
    "stage":{"id":"…","name":"Nuevos"},"state":"active"|"discarded","substate":{…}|null,
    "source":"manual"|"organic","entered_at":"…",
    "cv":{"file_name":"cv.pdf","uploaded_at":"…"}|null}],
 "created_at":"…"}
```

- Contact: manual → company record; organic → account email + current profile
  phone (same rule as the board detail). Each value string or null.
- Participations: every participation in the company's vacancies, most recent first.
- CV download: `…/participations/{participationId}/cv` streams the exact CV that
  participation references (company CV or candidate CV version), after checking the
  participation belongs to this candidate and company; 404 otherwise.
- Unknown `kind` or malformed id: 404.
