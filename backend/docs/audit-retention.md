# Audit log retention (`cmd/audit-purge`)

Contract: `docs/contracts/audit-log-v1.md` §6 (immutability) and §7 (retention, decision D2: 24 months).

## What it deletes

`audit-purge` deletes rows of `audit_events` whose `occurred_at` is older than **24 months**
(`occurred_at < now() - interval '24 months'`). Nothing else: rows 24 months old or newer are never selected, and no
other table is touched.

`audit_events` is append-only (migration `00056`): the trigger `audit_events_append_only` refuses every `UPDATE` and
`DELETE`. The purge is the single exception, and the trigger opens it only when **both** hold:

- the row is older than 24 months, and
- the transaction bound the flag to its own transaction id:
  `SELECT set_config('peopleflow.audit_purge', txid_current()::text, true)`.

A session-level `SET`, a role or database default, or a stale value never opens it. The command binds the flag at the
start of every batch transaction and never selects a row inside the retention, so the trigger is a backstop, not a path
the command relies on. The retention cutoff lives in two places that must stay identical: the trigger function and
`internal/features/audit_events/infrastructure/postgres/retention` (`expired`).

## Usage

```sh
export DATABASE_URL=...            # only from the environment; there is no flag for it

go run ./cmd/audit-purge           # dry run (default): counts, changes nothing
go run ./cmd/audit-purge -execute  # deletes
go run ./cmd/audit-purge -help
```

- **Dry run first.** It prints `audit_events_would_delete=<n>` and deletes nothing.
- `-execute` deletes in batches of 1000 rows ordered by `(occurred_at, id)`; each batch is its own transaction.
  It prints `audit_events_deleted=<n>`. Batches already committed stay committed if a later one fails.
- Running it again is safe: with nothing left to expire it prints `audit_events_deleted=0`.
- Failure: exit code 1, stderr `audit purge failed`, empty stdout. Driver errors, DSNs and argument values are never
  printed (the same rule as `cmd/psychometric-purge`). `SIGINT`/`SIGTERM` cancel the current batch (rolled back) and
  exit 1.
- Output carries counts only: no row content, no IDs, no personal data.

## Scheduling

The purge has to run **daily**. Nothing in this repository schedules it: that belongs to the deploy scheduler (AWS
work, not configured here). When wiring it, run the dry run first in the target environment, check the count, then
switch the job to `-execute`. Until a scheduler exists, rows older than 24 months simply stay; a missed day only
means the data is kept a little longer than the policy says, and the next run catches up.

## Operational notes

- `audit_events` has no index on `occurred_at` alone, so the count and each batch read the table sequentially. At the
  daily cadence only a day's worth of rows expires, but the first run on a backlog scans once per batch. If the table
  grows large, add an index on `(occurred_at, id)` in a migration; the command needs no change.
- Two overlapping runs are safe: batches lock rows with `FOR UPDATE SKIP LOCKED`.
- The database role needs `DELETE` on `audit_events` plus permission to run `set_config` (any role). The future
  least-privilege application role (contract D4) must not hold `DELETE`; give the purge job its own role.

## Tests

```sh
go test ./cmd/audit-purge -count=1
DRAFT_TEST_DATABASE_URL='postgres://draft_test:draft_test@127.0.0.1:55432/draft_test?sslmode=disable' \
  go test -tags=integration -p 1 -count=1 ./cmd/audit-purge/... ./internal/features/audit_events/...
```

The integration tests build a real `audit_events` table (migrations `00011` + `00056`, trigger included) in a throwaway
schema of the disposable `draft_test` database and drop it afterwards.
