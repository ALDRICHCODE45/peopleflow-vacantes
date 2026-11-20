# Replacement processes — reading the chain (R4)

Contract: [`docs/contracts/replacement-processes-v1.md`](../../docs/contracts/replacement-processes-v1.md). This page describes
how the backend serves `GET /v2/me/company/job-drafts/{id}/replacements`; starting (R3a–R3c), the lifecycle keys (R2) and the
departure (R5) live in `vacancy-lifecycle.md` and the contract.

## `GET V/replacements`

`V = /v2/me/company/job-drafts/{id}`. Private, `no-store`, no `ETag` (the body is derived from several resources), recruiter role.
Access is `GET V/lifecycle`'s: the company owner or an active tramo on `{id}`; any other recruiter, another company's draft and
an unknown id answer 404 `not_found`, a stakeholder 403, no session 401, a malformed id 400. One read snapshot; nothing is written.

It works on **any process of the chain** and returns the same chain payload from each; only the `start_replacement` block and
`carry_candidates` depend on `{id}` (the source a start would run from).

- `root_process_id`: the original of the logical vacancy (`{id}` itself when it is the original or was never published).
- `items`: the original first, then the replacements by `sequence`. Each has `id`, `kind`, `sequence` (**0 for the original**, 1..n),
  `replacement_of`, `title` (the draft's, so the list needs no second request), `visibility` (`public` with a projection, else `private`),
  `lifecycle` (`publication`, `process`, `close_reason`, `closed_at` only; ids and the rest stay on `GET V/lifecycle`),
  `started_at` (the process clock, `vacancy_processes.published_at`), `started_by`, `coverage` (`covered` = live Placement count,
  the board's definition; `required` = the process' `hiring_headcount`, null when unset), `replaced_credit_ids` (oldest hire first) and
  `can_open` (owner, or an active tramo on that draft). A draft that never published has no process: `items` is `[]`.
- `start_replacement`: `allowed`, `blocker` and `active_replacement_id` come from the source's own lifecycle view
  (`readLifecycle` → `can_start_replacement`, `start_replacement_blocker`, `active_replacement_id`), so they can never disagree with
  `GET V/lifecycle`. Only when `allowed` are the rest filled:
  - `startable_credits[]`: `credit_id`, `process_id`, `participation_id`, `candidate {kind, id, full_name}`, `hired_at`, `left_at`
    (the departure history row's time, else the credit's `status_changed_at`), `exit_reason` (the stored one) and the frozen
    `recipients[]` (by user id). A credit is startable when it is `did_not_hold`, belongs to a process of the chain and no
    replacement took it. The board item is not changed (feature doc L11).
  - `publish_ready` / `missing[]`: `publicationRequirements` evaluated on the **source's content**, without the six codes Start
    fills itself (`request_date_missing`, `hiring_headcount_missing`, `delivery_cutoff_missing`, `delivery_target_missing`,
    `commitment_date_missing`, `commitment_date_past`). Otherwise `publish_ready: null` and `missing: []`.
- `carry_candidates[]` (only when `allowed`, else `[]`), `carry_candidates_truncated`: one row per distinct candidate identity
  `{kind, id}` with a participation in any process of the chain, from its **most recent participation** (`created_at DESC, id DESC`;
  the kind is the identity column, as the start resolves it), **excluding candidates currently in Placement** (not discarded and
  in the Placement stage of their own process). Fields: `candidate {kind, id, full_name}`, `process_id` and `participation_id` of
  that participation, `stage {kind, name}` (the stage it is in, or, when `discarded`, the one it was discarded from; never an id),
  `discarded`, `eligible` (always `true` in v1, so no `reason`). Ordered by `full_name`, then id; at most 1000, one more row is read
  to set `carry_candidates_truncated`. The POST's `stage_id` is chosen among the stages of the source, not from this row.

Names are the board's company view: a company correction of an organic candidate's name wins over the account's. They are personal
data of the same exposure as the board listing (not an audited read); a recruiter with a tramo on `{id}` sees the candidates of the
whole chain, as the contract says.

## Code map

- `draftstore/replacement_read.go`: `Store.ReadReplacements` (items, credits, readiness), over the `replacements.sql` queries
  `ListReplacementChainItems`, `ListChainReplacedCredits`, `ListStartableCreditDetails`, `ListStartableCreditRecipients`.
- `draftstore/replacement_carry_read.go`: `readCarryCandidates` (raw SQL: it needs the per-process Placement stage ids as arrays).
- `http/replacementHandler.go`: `ReplacementHandlers{Start, List}`, served by `LifecycleHandler.ReplacementHandlers()`.

## Pinned by tests

`cmd/api/replacement_list_integration_test.go` (the payload, the chain from any process, blockers and readiness, the
most-recent-participation and placed-exclusion rules, the 1000 cap, permissions) and
`cmd/api/replacement_delivery_integration_test.go` (`GET V/pipeline/delivery` has no lifecycle guard: it works on a closed and on a
finished source, feature doc L11).
