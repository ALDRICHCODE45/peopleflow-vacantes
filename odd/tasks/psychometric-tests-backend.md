# Psychometric tests F1 — backend

Backend half of psychometric tests F1. Contract: `docs/contracts/psychometric-tests-v1.md` (agreed @fc9f00ce, owned by
the frontend session on `feat/psychometric-tests`). Content: `docs/psychometrics/*-v1.md` (structure/ids stable,
wording NOT frozen until user approval and legal review D9). Branch `feat/psychometric-tests-backend` based on fc9f00ce
(frontend branch is docs-only); the user pushes.

## Specs

- **S1 Content artifact.** Versioned embedded artifact `psychometrics.content.v1` / `psychometrics.scoring.v1`: 60 items
  (15 facets × 4, keys), 3 attention items at positions 16/32/48 (expected 2/5/3), 63-position order, scale labels,
  bands 4–9/10–14/15–20, 7 competencies with facet links and directions, 21 library entries, 84 questions + selection
  rules, quality thresholds, consent notice v1 text + SHA-256. A test parses `docs/psychometrics/*-v1.md` and fails on
  any drift.
- **S2 Pure scoring.** Facet sums (negative = `6 − value`), facet bands; competency oriented sums (`24 − s` for
  negative), band by exact integer rule «low if S < 10n, medium if S < 15n, else high», display index S/n half-up one
  decimal («pressure 29/3 → "9.7", still low»); fit/direction/focus per contract «Comparison rules»; quality signals and
  tiers with the contract thresholds; changes from ordered transitions («empty→2→4→empty→3 yields 1/1/1, total 3»);
  deterministic guide (max 8, STAR text). Finish requires all 63 positions.
- **S3–S10** API/DB slices per the contract: profile (B3), invitations (B4), link mint (B5), auto-trigger (B6),
  candidate endpoints (B7), public limiter (B8), result + comparisons (B9), retention purge (B10). E1–E3 later.

## Tasks

| ID | Specs | Route | Commit |
|----|-------|-------|--------|
| T1 | all | inline — capability evidence + contract rounds 1–2 with frontend | — |
| T2 | S1 | worker — B1 content artifact + immutable loader + docs drift guard implemented; vet/focused tests pass; archguard reports existing locked docker/minio/Dockerfile path | 43d48088 |
| T3 | S2 | worker — B2 pure scoring implemented: pinned facet/competency scoring, half-up display, interpretation snapshots, quality transitions/tiers, fit/focus and deterministic STAR guide; public-API boundary tables pass; RED missing-package failure observed before implementation, GREEN focused tests + go vet ./... pass; no docs ambiguities or B1 gaps found | 9a8d330d |
| T4 | S3 | worker — B3 profile GET/PUT + migration 00049 + jobs adapter; L25 follow-up (rationale only for relevant competencies); relevant rationale always a string (null → invalid, frontend 2026-10-29) | ac17f5e7, 800dd86f |
| T5 | S3–S10 | worker — B4 implemented: migration 00050, status-only board list, idempotent manual send, reminders/revoke, in-tx audits and error catalog; participation locking + expired-slot supersession preserve status/retention. RED missing package/table and unpublished-target 500 observed; GREEN focused/shared, routes, isolated API/checklist/board, guarded Downs and vet; archguard only pre-existing Dockerfile. B5–B10 remain separate. | ee7f19ba |
| T6 | S3–S10 | worker — B5 link mint implemented: crypto/rand 256-bit base64url, wire-byte SHA-256 only, in-tx rotation/audit with B4 gates/locks, no-store; unrouted lookup unifies malformed/unknown/revoked/expired. RED missing route/lookup observed; GREEN unit/routes + isolated DB rotation/concurrency/closed/audit rollback, migrations and vet pass; archguard only pre-existing Dockerfile. B6–B10 remain separate. (independent verify PASS) | 09e71378 |
| T7 | S3–S10 | worker + parent — B6 StageEntryHook port (applications) implemented by psychometrics; move/recovery/intake/apply only; system audit; parent ran archguard (only Dockerfile), go test ./internal/..., integration board/movement/discard/manual/apply/pipeline/checklist/psychometric all green | 533136c8 |
| T8 | S3–S10 | B7 public/account read, consent, items and ordered/idempotent answers; account latest list; privacy headers, B5 recheck under B4 locks, consent audit and guarded migration 00051. B7b adds finish: pinned B2 output and initial comparison/full confirmed profile snapshot, sorted incomplete positions, atomic finish retention/audit and exactly-once concurrent completion; assessment_finished on both paths. RED missing finish routes observed; focused finish HTTP GREEN (snapshot equality, changes 1/1/1, unconfirmed profile, concurrency, audit rollback). B8/B9 unchanged. | 45dfd028, e8a05157 |
| T9 | S3–S10 | B8 public limiter + headers (own commit, security) | pending |
| T10 | S3–S10 | worker — B9 result GET (audited, strict projection per contract 75c0c690) + comparisons POST (B2 Recompare on stored bands, immutable history, 409 profile_unconfirmed/process_finished, 404 unfinished/past retention). RED missing routes; GREEN 49 psychometric/checklist integration on draft_test, unit, vet; archguard only Dockerfile | ae26f78f |
| T11 | S3–S10 | B10 retention purge (own commit, data deletion) | pending |

## Log

- **L1.** Frontend session (2026-10-29), relaying the user's feature: «New large feature starting: Psychometric tests F1
  … Same pattern as the checklist: frontend owns docs/contracts/psychometric-tests-v1.md, you review it before any
  code.» Final go: «Please do a final contract check; if OK you can start B1 (structure + drift guard) and B2 (pure
  scoring) on feat/psychometric-tests-backend.»
- **L2.** User decisions relayed: IPIP subset of 60 items/15 facets + comp.presion (L15), scale labels «No me describe
  nada / Me describe poco / Me describe a medias / Me describe bastante / Me describe totalmente» (L17), retention 12
  months, expiry default 7 days, no AI in F1, email/reminders/scheduled purge last (E1–E3).
- **L3.** Contract agreed @fc9f00ce with nits n1–n4 sent (PUT profile body, changes always known in v1,
  estimated_minutes, DELETE body).
- **L4.** B1 committed 43d48088 (worker; `go vet ./...` and psychometrics tests pass). Slice size is dominated by the
  generated `content.v1.json` (1,899 lines of data) and the frontend docs base; code is ~900 lines. `go run
  ./cmd/archguard` fails on the pre-existing `backend/docker/minio/Dockerfile` (f03af5fe, on main), unrelated to this
  feature. Merged frontend 938a265c (3f5ec00f).
- **L5.** B3 committed ac17f5e7 (worker + parent verification). Parent ran on an isolated `draft_test` in the Docker
  Postgres (geo seeded with `cmd/geoimport -skip-postal-codes`): `go test -tags integration ./cmd/api -run
  '^(TestPsychometricProfile|TestChecklistFlow)'` ok, so the earlier checklist geo failure was the empty fixture DB.
  Full `go test ./...` fails only `scripts/closure`: macOS bash 3.2 cannot parse `case … ;;` inside `$(…)`
  (scripts/closure/gate:44, pre-existing on main). Jobs adapter `draftstore/psychometric_profile_context.go` reuses
  the checklist guards without cross-feature imports (parent-approved).
- **L6.** Frontend relayed user decision L25 (8d0e134a, merged 6b7b7e75; the frontend branch now also carries frontend
  code, merged as shared history): «profile `rationale` is required only for importance.clave and
  importance.importante (task only for clave). importance.no_relevante ⇒ desired_band, rationale AND task are null
  (always, also in drafts); never-saved defaults = no_relevante with rationale null.» B3 follow-up in progress.
- **L7.** B6 worker timed out during a host stall: macOS syspolicyd/XProtect assessed every freshly built test binary
  (pure unit packages killed at 6 min). User added the terminal to Privacy & Security → Developer Tools (2026-10-29);
  parent re-measured draftjson tests 6 min → 2 s, then verified B6 and committed it. Account list agreed (frontend
  36ed3d22, merged f4ce0aef): only the latest invitation per (participation, test), user «Solo la más reciente».
- **L8.** B7b finish committed e8a05157 after the Mac reboot: 44 psychometric/checklist integration tests PASS on the
  isolated `draft_test` (`DRAFT_TEST_DATABASE_URL` must be exported, otherwise they SKIP silently); independent
  verify launched. Delivery decision, user verbatim: «la entrega debe ser merge hermano. porque todo ya estara
  validado y revisado (nativamente tambien si es necesario).» → one merge of the feature branch into main once
  B8–B10 are validated and reviewed, coordinated with the frontend; no chained PRs.
- **L9.** B7b independent verify PASS (S7; S9 initial persistence; S10 finish anchor). Frontend asked B9 first for T12
  browser QA (strict zod; latest_comparison non-nullable; no If-Match). B9 contract change agreed with the frontend,
  contract 75c0c690: Result interpretations[] = {id, competency_id, band, intro_text, work_text, strengths_text,
  development_text, hypothesis_text} (intro_text ← stored prepend, hypothesis_text ← stored hypothesis, plain strings);
  the wire omits headings, question_ids, guide tier and context_label, which stay in the stored snapshots. Comparison
  POST on a finished process → 409 process_finished. B8 runs in parallel; it is wired into the router after B9.
