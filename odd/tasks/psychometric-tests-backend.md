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
| T4 | S3–S10 | B3–B10, one commit each; B5/B8/B10 isolated for verification | pending |

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
