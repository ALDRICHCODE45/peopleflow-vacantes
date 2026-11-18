# Professional title in the application profile snapshot

Branch feat/snapshot-professional-title (from main 4771d3fe). Backend only; the frontend already labels the field
«Lo ven las empresas».

## Specs

- **S1** User decision (via the frontend session, 2026-11-18): «Que lo vean las empresas». Request: «agregá
  `professional_title` a `process_participations.profile_snapshot`, tomado al postular, y exponelo donde la empresa ve
  el snapshot, o sea en el detalle del pipeline y en la base de talento. Sumá test, actualizá el contrato y avisame el
  commit y el nombre del campo.»
- **S2** «En la sección «recent» puede seguir en vivo o pasar a leer del snapshot; elegí lo coherente y avisame cuál.»
  Parent decision: read it from the snapshot, like every other profile field the company sees (the company sees the
  copy taken at application time).

## Tasks

- [x] T1 (S1, S2) Snapshot key, board/pipeline detail, talent base list/detail, dashboard recent, contract, tests — worker; commits: migration 00061, then behavior.
- [ ] T2 Independent verification (Risk: item 1, schema constraint migration 00061).

## Log

- **L1** Read-only finding before this task: today the snapshot freezes 6 keys (location, skills, years, seniority,
  education summary, languages; applications v2/store.go:122-128,185, v2/profile.go:22-29); board reads
  COALESCE(p.profile_snapshot, …) (board/store.go:124); talent base uses the last participation's snapshot
  (pool/query.go:39) and returns professional_title NULL for organic candidates unless corrected (pool/query.go:36);
  dashboard recent reads cp.professional_title live (metrics infrastructure history.go:184-185); corrections overlay
  via candidateview EffectiveProfileSQL (title is already a correctable field).
- **L2** The DB check `participation_profile_snapshot_shape` (00043) allowed exactly 6 keys. Parent approved a
  constraint-only migration 00061 (key optional: absent/null/string up to 120; no backfill; guarded Down restoring
  00043). Parent decision on over-long titles (profile writes have no server-side length limit; the form caps at 120):
  the snapshot keeps the first 120 characters (apply never fails). Fields: snapshot `professional_title`; board
  card/detail `profile.professional_title` (+ `original.professional_title`); talent base top-level `professional_title`
  now from the latest snapshot for organic candidates, correction wins; dashboard v2
  `recent[].candidate.professional_title` from the snapshot. Legacy GET /v2/me/company/dashboard still reads the live
  title until T12 removes it.
- **L3** Incident: a `make test-integration` run over ./internal/features/applications/... reached the LOCAL dev DB
  (the legacy package reads DATABASE_URL from the backend env file) and recreated the missing legacy `applications`
  table (empty). Checked: goose 60, demo companies and Valeria's participations intact; no repair.
- **L4** Worker checks: unit applications/metrics/candidates ok; v2 integration 108 PASS; cmd/api 86 + 120 PASS
  (snapshot-related suites); db/migrations 92 PASS; vet, gofmt, sqlc compile clean. Not run: candidates and legacy
  applications Postgres packages (they read the env file DATABASE_URL).
