# Remove birth date and cover letter (backend)

Backend half of closing two 2 Oct 2026 partner agreements. Branch `feat/remove-birthdate-cover-letter-backend`
(worktree `../peopleflow-vacantes-nobirth`). The frontend session stops sending and showing the fields first.

## Specs

- **S1** (A) «Quitar la fecha de nacimiento y la edad del candidato. Ya no se capturan en la carga del reclutador, pero siguen en el perfil del candidato.»
  `GET /me/profile` no longer returns `birth_date`. `PUT /me/profile` still accepts the key `birth_date` during the
  transition (any value, including `null`, including an invalid date) and ignores it: no 400, nothing stored.
- **S2** (B) «Quitar la carta de presentación. Ya no se pide en pantalla; falta la limpieza interna en modelo, API y base.»
  The legacy routes (`POST /jobs/{jobId}/applications`, `PATCH` transition, `GET /jobs/{jobId}/applications(/{id})`,
  `GET /me/applications`) no longer accept or return `cover_letter`; a client that still sends it is ignored (lax decoder).
  Domain, use case, repository and sqlc lose the field.
- **S3** Stored data: user decision «Borrar las columnas (DROP), con backup antes (recomendado)». A separate migration
  drops `candidate_profiles.birth_date` and `applications.cover_letter`, in its own commit after the code stops using
  them. Deploy note: take a database backup before applying it in production.

## Tasks

- [x] T1 (S1) Profile: stop returning `birth_date`, accept-and-ignore it in PUT; entity, DTO, use case, repository, tests, docs — inline. Commit `2fc47837`.
- [x] T2 (S2) Legacy applications: remove `cover_letter` from DTOs, entity, use case, repository, tests, docs — inline. Commit `964f3948`.
- [x] T3 (S3) Migration 00062 drops both columns; sqlc regenerated; DDL test copies; own commit — inline. Risk: item 1. Commit `1fc5668f`.
- [x] T4 Independent verify (Risk items 1 and 3) — gentle-ai-verify: S1 PASS, S2 PASS, S3 PASS (L5).

## Log

- **L1** 2026-11-19, relayed by the frontend session as already authorized by the user: «cerrar los dos acuerdos del 2 de octubre que quedaron parciales. (A) Quitar la fecha de nacimiento y la edad del candidato. Ya no se capturan en la carga del reclutador, pero siguen en el perfil del candidato. (B) Quitar la carta de presentación. Ya no se pide en pantalla; falta la limpieza interna en modelo, API y base.» Split: backend here, frontend in its session.
- **L2** Backend map (read-only explore): `birth_date` only in `candidate_profiles` (00006:13) and GET/PUT `/me/profile` (strict decoder, profile_fields.go:33); not in snapshots, board, talent pool, exports, manual intake (already rejected), audit. `cover_letter` only in legacy `applications` (00010:19) and the legacy routes (lax decoder); excluded from audit on purpose. Frontend confirmed it calls no legacy route and will stop sending `birth_date`.
- **L3** User decision on stored data: «Borrar las columnas (DROP), con backup antes (recomendado)».
- **L4** T1-T3 implemented test-first on the branch (commits above). RED observed before each code change: T1 (PUT `birth_date:"not-a-date"` was 400, GET/PUT still carried `birth_date`), T2 (`cover_letter` still returned as a key on all five legacy routes; `"   "` was 400). Checks: `cd backend && make test` green after each commit (115 packages ok); `go vet -tags integration ./...` clean; `make sqlc` leaves no diff; gofmt clean. `make test-integration` NOT run (can hit the dev DB through .env), so migration 00062 and the integration fixture changes are compiled but not executed. Notes: PUT keeps the key via `IgnoredBirthDate json.RawMessage` (strict decoder); the audit guard `TestBuildSubmittedMetadata_NeverCoverLetterOrCandidateID` now also forbids `cover_letter`/`candidate_id` keys explicitly across the three builders; DDL copies in `00005_integration_test.go`, `migration_00007_test.go`, `migration_00010_test.go` were left untouched because they model historical schemas and do not break with the columns dropped; traceability.json test names updated.
- **L5** T4 independent verify: S1/S2/S3 PASS. make test exit 0 (115 pkgs); make sqlc no diff; vet -tags integration clean; goose 00062 up/down/up on an isolated postgres:16 container (no .env): columns dropped, restored nullable, dropped again. Integration per package on fresh isolated DBs: all candidates/applications/cmd/api flows pass; 2 failures pre-existing at version 61 and untouched by the branch (TestUsersMigrationDownDropsTable 00005_integration_test.go:129, TestJobsMigrationDownDropsTable migration_00007_test.go:146, 2BP01 dependent objects). Deploy: production backup before 00062 still pending (deploy step).
