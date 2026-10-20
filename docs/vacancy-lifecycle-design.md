# §21 Vacancy lifecycle: pause, close, finish process, reopen (proposal, for frontend review)

Status: design only, no code yet. Tracking: `odd/tasks/vacancy-lifecycle.md` (S1–S7).
Code map that grounds this design: L2 in that file.

## 21.1 Two axes

A published vacancy has two independent axes (S3):

| Axis | Values | Controls |
|---|---|---|
| **Publication** (`publication`) | `published`, `paused`, `closed` | Public visibility and new applications |
| **Process** (`process`) | `active`, `finished` | Moves, discards, recoveries, substates, pipeline/substates/delivery/management edits |

A draft that was never published has no lifecycle (`publication: null`). It can never return to draft.

Invariant: `process = finished` only when `publication = closed`. Pausing always keeps the process active (S2, S3).

The resulting **states**:

| State | publication | process | Public listing/search | Public link | New applications | Board |
|---|---|---|---|---|---|---|
| Draft | — | — | no | 404 | no | n/a |
| Published | `published` | `active` | yes | detail | yes | normal |
| Paused | `paused` | `active` | no | «Vacante pausada» | no | normal |
| Closed, process ongoing | `closed` | `active` | no | «Vacante cerrada» | no | normal |
| Closed, process finished | `closed` | `finished` | no | «Vacante cerrada» | no | read-only |

## 21.2 Transitions

| Action | From | To | Notes |
|---|---|---|---|
| `publish` (existing) | Draft | Published | Unchanged: `POST …/publication`. |
| `pause` | Published | Paused | — |
| `resume` | Paused | Published | Published-write readiness guard (§21.6). |
| `close` + `process: "continue"` | Published, Paused | Closed, process ongoing | Body must name the choice; there is no default (S3: the dialog offers both). |
| `close` + `process: "finish"` | Published, Paused | Closed, process finished | — |
| `finish_process` | Closed, process ongoing | Closed, process finished | S3: «después podés "Finalizar proceso" por separado». |
| `reopen` | Closed (either process value) | Published, process active | S4: pipeline, candidates and history all intact. Same readiness guard as `resume`. |

Rejected on purpose:
- Pausing a closed vacancy.
- Resuming a closed vacancy (use `reopen`).
- Closing an already closed vacancy.
- Finishing the process of a published or paused vacancy (close first).
- Reopening a published or paused vacancy.
- Any transition back to Draft.

Each of these returns **409 `lifecycle_transition_invalid`** with
`data: {"action":"…","publication":"…","process":"…"}` describing the current state.

There is **no automatic close** (S5): every transition is manual.

**Recommended (frontend asked):** reopening a *finished* vacancy is allowed and reactivates its process. S4 says reopening restores everything, and finishing is the user's own choice, reversible like closing.

## 21.3 Who can act — OPEN DECISION (user)

**Recommended:** the same people who can publish today, which is the company owner or the vacancy's principal recruiter.
- Same live gates as publish: live user, active company, current membership.
- Anyone else gets the existing 404 `not_found`, as for every vacancy-scoped write.

## 21.4 API

Base path: `/v2/me/company/job-drafts/{id}/lifecycle`.

| Route | Purpose |
|---|---|
| `GET …/lifecycle` | Current lifecycle view and its ETag. A never-published draft returns 200 with `publication: null` and `allowed_actions: ["publish"]`. |
| `POST …/lifecycle/pause` | — |
| `POST …/lifecycle/resume` | — |
| `POST …/lifecycle/close` | Body `{"process":"continue"\|"finish"}` (required). |
| `POST …/lifecycle/finish-process` | — |
| `POST …/lifecycle/reopen` | — |
| `GET …/lifecycle/history` | Vacancy-level history (§21.8). |

**Request rules** (same as publish), checked in this order:
1. Authorization.
2. Idempotency key.
3. Precondition.
4. Transition validity.
5. Readiness.
6. Atomic write (state, version, history row, audit).

Details:
- `Idempotency-Key` (UUID) is required. An exact replay returns the original response with `Idempotency-Replayed`.
- `If-Match` takes the **lifecycle ETag** `"vl-<draftId>-v<N>"`. It is independent from the draft content ETag, so editing text never conflicts with a pause.
- Missing `If-Match` → 428; mismatch → 412.
- The body is `{}` except for `close`. Unknown keys → 400 `invalid_request`.

**Lifecycle view** (GET and every 200 response):

```json
{"publication":"closed","process":"active","version":"4",
 "published_at":"…","paused_at":null,"closed_at":"…","process_finished_at":null,
 "allowed_actions":["finish_process","reopen"]}
```

- `allowed_actions` follows §21.2, so the UI does not hardcode the transition table.
- The `*_at` fields carry the time of the latest such transition, or `null`.

## 21.5 Effects by state

### Public (`/v2/jobs`)

- **List and search:** only Published vacancies appear. This already holds, because the queries filter on `status = 'published'`.
- **Detail of a Paused or Closed vacancy:** **410 `vacancy_unavailable`** with
  `data: {"id","title","company":{"id","name"},"availability":"paused"|"closed"}`.
  - The frontend renders «Vacante pausada» or «Vacante cerrada», with `noindex`.
  - Description, compensation and screening are **not** returned.
  - Drafts and unknown ids keep returning 404 `not_found`.

### Applying

| Request | Paused / Closed |
|---|---|
| `GET /v2/jobs/{id}/screening` | 410 `vacancy_unavailable` (same `data`) |
| `POST /v2/jobs/{id}/applications` | 409 `vacancy_not_accepting_applications`, `data: {"availability":"paused"\|"closed"}` |

- Apply order:
  1. Locks.
  2. **Idempotency replay**: a replay of an earlier success still succeeds after a pause or close.
  3. Availability gate.
  4. Country gate (G4).
  5. Screening, CV and duplicate checks.
- Drafts and unknown ids stay 404.

### Board and configuration

| Request | Process `active` (any publication) | Process `finished` |
|---|---|---|
| move / discard / recover / substate | allowed (today they require `published`; they now require an active process) | 409 `process_finished` |
| pipeline PUT and preview, substates PUT, delivery PUT, management PUT | allowed | 409 `process_finished` |
| GET board / detail / history / CV, lifecycle GET | allowed | allowed (read-only) |
| content PATCH (texts, location, …) | allowed | allowed |

Content PATCH stays open when finished so a closed vacancy can be fixed before `reopen`. It keeps refreshing the public projection as today; the projection simply stays hidden while paused or closed, because public queries only show `published`.

### Candidate (`GET /v2/me/applications`)

- Each item adds `vacancy.state`: `"open"` or `"closed"`.
  - `"closed"` means process `finished` (S3: «los candidatos activos ven "Vacante cerrada"»).
  - A paused vacancy, or a closed one whose process continues, stays `"open"` for its applicants, because their process is still running.
- The application `status` (`submitted` / `in_process` / `closed` = discarded) is unchanged.
- Ordering and the rest of the item shape are unchanged.

### Company list (`GET /v2/me/company/job-drafts`)

- `status` becomes `draft | published | paused | closed`; today it can only be `draft | published`.
- New `process`: `null` (drafts) or `"active" | "finished"`.
- Badge and actions per state:

| State | Badge | Actions |
|---|---|---|
| Draft | Borrador | Publicar |
| Published | Publicada | Pausar, Cerrar |
| Paused | Pausada | Reanudar, Cerrar |
| Closed, process ongoing | Cerrada · en proceso | Finalizar proceso, Reabrir |
| Closed, process finished | Cerrada · proceso finalizado | Reabrir |

## 21.6 Readiness on `resume` and `reopen`

Both run the **published-write guard**: every readiness rule except `commitment_date_past`, the same rule as editing a published vacancy.
- Failure → 422 `publication_incomplete` with `missing`.
- This prevents re-exposing a vacancy that was edited into an incomplete state while hidden.

## 21.7 «Finalizar proceso» vs delivery fulfillment (frontend asked)

They are **different**:
- **Fulfillment** freezes the *delivery snapshot* (target, cutoff, delivered candidates, result) when the target is reached, and blocks only delivery changes (409 `delivery_fulfilled`). Moves continue.
- **Finish process** freezes the *whole process*: every board and configuration mutation is blocked (409 `process_finished`). It records no fulfillment.

How they combine:
- The delivery status stays readable as it was. If the target was never reached, it stays «no cumplida» and cannot change, since nothing can move.
- `reopen` unlocks the process. An existing fulfillment snapshot stays frozen, as today.

## 21.8 History

Participation history is per candidate, so lifecycle events do **not** write rows there. Writing one row per candidate on every pause would be noise.

Instead:
- A new **vacancy lifecycle history** records `pause`, `resume`, `close` (with `process`), `finish_process` and `reopen`, each with actor `{id,name}` and timestamp.
- It is exposed by `GET …/lifecycle/history` → `{items:[…]}`, newest first.
- Audit events: `VacancyPaused`, `VacancyResumed`, `VacancyClosed`, `VacancyProcessFinished`, `VacancyReopened`.

**Open for frontend:** whether the board shows this history (for example in a vacancy sheet).

## 21.9 Storage

Migration **00034**, additive:
- `vacancy_processes.status` CHECK widened to `published | paused | closed`.
- New `process_status` (`active` default | `finished`), with CHECK `process_status = 'finished'` ⇒ `status = 'closed'`.
- New `lifecycle_version BIGINT`.
- New timestamps `paused_at`, `closed_at`, `process_finished_at`.
- New table `vacancy_lifecycle_events`.
- Down refuses while any row is not `published` + `active` or any lifecycle event exists.

Existing published vacancies become Published / active at version 1.

## 21.10 Cuts

| Cut | Contents |
|---|---|
| L1 | Migration 00034; lifecycle GET, five actions and history; transition rules, ETag and idempotency; audit |
| L2 | Effects: public detail 410, screening/apply gates, board/configuration `process_finished`, candidate `vacancy.state`, company list `status`/`process` |

Vacancy SEO (T63) then builds on this: `validThrough`, and Indexing API removal on close.
