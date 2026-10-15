# Draft list (backend) — GET /v2/me/company/job-drafts

Backend slice so a recruiter can find saved private drafts and reopen them. Branch `feat/draft-list` from `main` 40c91ea (local, no PR; merge to main only after real browser approval, user pushes). Frontend peer (session 01a14144-5c1b) builds the list UI and reopen/edit/save (its T8) in parallel.

## Specs

- S1 — User request (verbatim): «Si hermano, estoy de acuerdo, por favor. coordinate con el frontend para poder hacer eso, mientras tu trabajas con el backend, el frontend hace la ui y conecciones necesarias». Agreed scope (previous turn, accepted): «backend con `GET /v2/me/company/job-drafts` (lista paginada de borradores de la empresa)» as the base for the frontend to reopen/edit/save existing drafts.
- S2 — Route: `GET /v2/me/company/job-drafts?limit=&cursor=`, Bearer, same route group as the other v2 draft endpoints (NoStore before requireAuth + requireRecruiter). `Cache-Control: no-store`.
- S3 — 200 body (agreed with the frontend, L4): `{"items":[{"id":uuid,"title":string|null,"requester":null|{"kind":"internal_area"|"client","id":uuid|null,"name":string|null},"principal_recruiter":{"id":uuid,"name":string|null},"version":string,"created_at":RFC3339,"updated_at":RFC3339}],"next_cursor":null|string}`. Field values equal those of `GET /v2/me/company/job-drafts/{id}` for the same draft; `principal_recruiter.name` is `users.full_name`, null only when that user is soft-deleted. `title: null` and `requester {kind, id:null, name:null}` are valid.
- S4 — Order `updated_at DESC, id DESC`; `limit` default 20, range 1..50; `next_cursor` opaque, sent back as-is; `null` on the last page.
- S5 — Visibility: owner sees every schema-2 draft of the session company; a recruiter sees only drafts where they are `principal_recruiter_id` (same rule as GET by id). v1 drafts never appear. Other companies' drafts never appear. No search or filters in this slice.
- S6 — Errors `{error,code}`: 400 invalid_request (bad limit or cursor, cursor of another company or user, repeated parameter), 401 unauthenticated, 403 forbidden, 403 company_inactive, 409 company_not_active, 500 internal_error. Unknown parameters are ignored, like the requester list.
- S7 — A draft saved during pagination moves to the top and may be missed on later pages; restarting without cursor shows it. Documented, not prevented.

## Tasks

- T1 | S4,S6 | inline | pure package `application/draftlist`: limit parsing + cursor codec (company, actor, last updated_at µs UTC, last id) with strict decoding; Lister port and Item/Page types | done: RED 5/5 tests (37 cases) failed on stub; GREEN 37 PASS after raw version-token check (draftjson reads 1.0/1e0 as 1); vet/gofmt clean | commit: (this)
- T2 | S3,S4,S5,S7 | inline | draftstore `ListV2`: gates, visibility, schema-2 filter, keyset, title/requester projection; isolated-PostgreSQL integration tests | pending | commit: —
- T3 | S2,S3,S6 | inline | HTTP handler + router wiring + topology/real-router tests | pending | commit: —
- T4 | S1-S7 | inline | docs (`backend/docs/private-job-drafts.md`), frontend handoff, final checks | pending | commit: —
- T5 | S5,S6 | gentle-ai-verify | independent verification (Risk item 2: visibility/authorization) and fixes | pending | commit: —

## Log

L1 — User request verbatim: «Si hermano, estoy de acuerdo, por favor. coordinate con el frontend para poder hacer eso, mientras tu trabajas con el backend, el frontend hace la ui y conecciones necesarias».
L2 — Contract proposal sent to the frontend peer 01a14144-5c1b (S2-S7). It said unknown parameter → 400; corrected to "ignored" (S6) for parity with the requester list; to be restated in the final handoff.
L4 — Frontend reply (d4ebd9d9): contract OK; optional request «"principal_recruiter": {"id": uuid, "name": string|null}» so the owner can see whose draft it is. Accepted (cheap LEFT JOIN users); it replaces `principal_recruiter_id` in the row. Confirmed title null and requester id null are valid; unknown params ignored.
L3 — Design: new pure package `application/draftlist`; store method on `draftstore.Store` reusing `lockGates`, `authorized` rule in SQL (`owner OR principal_recruiter_id = actor`), schema filter `convert_from(fields,'UTF8')::jsonb->>'schema_version' = '2'`, each returned row validated with `requireV2ReadDocument` (corrupt row → 500 as in GET). No new migration/index in this slice (existing `job_drafts_company_id_idx`); a `(company_id, updated_at DESC, id DESC)` index is a follow-up.
