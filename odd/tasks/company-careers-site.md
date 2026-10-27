# Company careers site — backend (contract v1)

Backend half of `odd/tasks/company-careers-builder.md` (frontend branch feat/company-careers-builder). Implements
`docs/contracts/company-careers-site-v1.md` (proposal 42f7887d) with the amendments agreed in L2. Branch
feat/company-careers-site; no merge to main, no push (user reviews in the morning).

## Specs

- **S1** (L1). «Implementalo en tu propia rama: migración, endpoints §3 y §4, y el filtro company_id del catálogo. Con
  tests.»
- **S2** (L1). «Sin merge a main ni push: el usuario revisa mañana.»
- **S3** (L1). «Avisame rama + SHA cuando cada parte esté lista (primero GET/PUT del borrador, después publicar, media y
  lectura pública).»
- **S4** (L1, contract §2, §3.1, §3.2, §3.5). Site document (slug, theme, seo, blocks with the §2.1 table), lazy
  `GET /v2/me/company/site`, `PUT /v2/me/company/site/draft` with `If-Match`, 428/412/422/409, slug availability. Draft
  saves accept incomplete content; maximums, formats, consent, URL rules and unknown keys enforced on every save.
- **S5** (L1, contract §3.3). Owner-only publish (If-Match, `publish_blocked` issues) and idempotent unpublish.
- **S6** (L1, contract §3.4). Media upload: JPEG/PNG/WebP by magic bytes, ≤ 5 MB, 200–6,000 px, EXIF stripped, 201
  `{id, kind, url, width, height, content_type}`, 413/415/422.
- **S7** (L1, contract §4.1, §4.2). Public `GET /v2/company-sites/{slug}` (404 `site_not_found`, old-slug resolution)
  and `GET /v2/jobs?company_id=` (invalid UUID → 400 `invalid_filter`).
- **S9** (L17). S3 storage for site media only (frontend T7): «servir «Backend las sirve (Recomendado)»; local/integración
  «MinIO en Docker (Recomendado)»; alcance «Solo imágenes del sitio»; implementa «La sesión de backend».» Private
  bucket; `GET /v2/company-sites/media/{id}` reads from S3 and answers exactly as today; env-selected disk (default) or
  S3; credentials only via the SDK default chain (IAM role in deployment), never in code or logs; region, bucket and
  prefix by env, documented; unit tests + MinIO integration via docker compose (put/get/head/not-found/content-type,
  large objects, network errors → domain error without leaking details); candidate CVs unchanged.
- **S8** (L2). Agreed amendments: media served by public `GET /v2/company-sites/media/{id}` (capability URL, immutable
  caching); old slug → 200 same §4.1 shape with current `slug`; published snapshot is a copy; `story.body` via
  `draftrich.ValidateDocument` + ≤ 5,000 code points; 412 `{error, code, current}`; identical PUT is a no-op; public
  read drops hidden blocks and unreferenced media; PUT body ≤ 1 MiB; ≤ 300 media per company (`media_limit_reached`);
  publish/unpublish audited; publish without If-Match → 428; EXIF stripped without re-encoding; `company.location` as in
  `GET /companies/{id}`.

## Tasks

- [x] T1 — S1, S4, S8: migration + document validation + GET/PUT draft + slug availability — route: worker — commit: ee16597b
- [x] T2 — S5, S8: publish/unpublish (owner, issues, audit) — route: worker — commit: a7c34f17
- [x] T3 — S6, S8: media upload + public media read — route: worker + independent verify — commit: bea083c2
- [x] T4 — S7, S8: public site read + catalog company_id filter — route: worker + parent differential + independent verify — commit: see git log (feat(company-sites): public careers site)
- [x] T5 — S9: S3 adapter for site media + env selection + MinIO integration — route: worker + independent verify (2 rounds) — commit: f03af5fe

## Log

- **L1.** Frontend session (2026-10-26, verbatim): «Hola, soy la sesión frontend de PeopleFlow. El usuario aprobó
  (2026-10-26) un sitio de empleo por empresa construido por bloques, con borrador autoguardado y publicación en
  /empresas/<slug>, y que vos y yo lo implementemos esta noche. Contrato propuesto: docs/contracts/company-careers-site-v1.md,
  en el commit de mi rama feat/company-careers-builder (worktree peopleflow-vacantes-frontend; leelo desde ahí).
  Decisiones de producto: odd/tasks/company-careers-builder.md S1–S11. Te pido: 1. Revisá el contrato y respondeme qué
  cambiarías (en especial los 4 puntos abiertos de §6) antes de implementar. Si no cambia nada, decime «contrato OK».
  2. Implementalo en tu propia rama: migración, endpoints §3 y §4, y el filtro company_id del catálogo. Con tests. 3. Sin
  merge a main ni push: el usuario revisa mañana. 4. Avisame rama + SHA cuando cada parte esté lista (primero GET/PUT del
  borrador, después publicar, media y lectura pública). No toco backend/. Yo implemento el frontend contra este contrato.»
- **L2.** Backend reply sent (amendments S8). Finding: the backend has no S3 adapter, only the local storage port used
  by CVs; media therefore use a public capability URL on the API, swappable for S3/CloudFront later.
- **L3.** Frontend (verbatim): «tus 12 cambios OK, todos aceptados. Sobre el punto 1 (media): como el origen de la API es
  solo de servidor (D3), el frontend va a servir `/v2/company-sites/media/{id}` desde su propio origen con un rewrite o
  una ruta. No te cambia nada.» Plus: «A) Video: el contenido guarda `video: {provider: "youtube"|"vimeo", video_id} |
  null`, no la URL. El cliente parsea el link pegado. Validá provider y video_id: YouTube `^[A-Za-z0-9_-]{11}$`, Vimeo
  `^\d{1,12}$`.» and «B) Requisitos para publicar (solo bloques visibles; si falta algo → `block_incomplete` con
  `blocks[i]`)» — the table now in contract §2.1 «Publish requirements». The agreed contract is commit 55966df2 on
  feat/company-careers-builder: read it with `git show feat/company-careers-builder:docs/contracts/company-careers-site-v1.md`
  (it is the normative wire spec for every task; §6 lists the agreed amendments).
- **L4.** Backend corrections sent to the frontend (existing shared gates/catalog are pinned by tests and stay): (1)
  `validation_error` is **400** with `{error, code:"validation_error", fields:[{field, code}]}`
  (`httpjson.WriteValidationError`), not 422; (2) a non-owner on publish/unpublish gets **403 `forbidden`** from
  `requireOwner`; (3) a non-member gets **403 `forbidden`** from `requireRecruiter` and a deleted company **403
  `company_inactive`** — no `company_not_found`. New codes: `slug_taken` 409, `slug_reserved` 422, `publish_blocked` 422,
  `site_not_found` 404, `unsupported_media_type` 415, `image_too_small`/`image_too_large`/`media_limit_reached` 422;
  `payload_too_large` 413 already exists.
- **L5.** Backend design and conventions (evidence for workers):
  - New feature slice `backend/internal/features/companysites/` (application = pure document validation + store
    interface; infrastructure/postgres = pgx store with raw SQL in one tx per operation, like
    `applications/infrastructure/postgres/pool/corrections.go`; infrastructure/http = handler). Wire it in
    `cmd/api/main.go` and `cmd/api/router.go` (routerDeps field), and add each new route to the pinned list in
    `cmd/api/main_test.go` `TestRouteTopology_ExactRegistrations`.
  - Private routes: a root-router `r.Group` with `identityhttp.NoStore, d.requireAuth, d.requireRecruiter` (as the
    candidates pool group in router.go); publish/unpublish additionally `r.With(d.requireOwner)` inside a NoStore group.
    Company identity only from `security.CompanyContextFromContext` (CompanyID, UserID, Role).
  - Strict JSON: `draftjson.Decode` (rejects duplicate keys, numbers as int64); errors via `httpjson` catalog — add a
    `site_errors.go` extension like `publication_errors.go` and hook it into `Resolve`'s default chain; extension code
    lists have pinning tests in the httpjson package.
  - Rich text: `jobs/application/draftrich.ValidateDocument` returns `{Canonical, Plain}`; `story.body` additionally
    needs ≤ 5,000 code points of Plain, and non-blank Plain to publish.
  - Audit: `audit_events` repo `Append(ctx, tx, entities.AuditEvent)`; add event constants (e.g. `CompanySitePublished`,
    `CompanySiteUnpublished`) and entity `company_site` in `audit_events/domain/entities/auditEvent.go`; metadata
    PII-free.
  - Migration = next goose file `backend/db/migrations/00047_company_sites.sql` (Up + guarded Down like 00045); then
    `make sqlc` (closure SQLc drift test fails otherwise).
  - Storage: only `candidates/infrastructure/storage.Local` (`Put(ctx, data) (key, error)`, `Open`, `Delete`), rooted at
    the CV storage root; there is no S3 adapter.
  - Integration tests: `//go:build integration` in `cmd/api`, harness `newDraftFlowHarness` /
    `draftFlowNewPrincipal` / `company.addUser(t, "recruiter")` / `h.actor` / `h.do`; fixture cleanup must delete site
    rows before companies are deleted. Unit route tests use `routeRequireAuth` and `routeRoleGate(...)` helpers.
- **L6.** Data model decided by the backend (T1 creates all of it so T2–T4 add no migration):
  - `company_sites`: one row per company (PK/FK `company_id`), `draft` JSONB canonical document, `draft_version`
    BIGINT ≥ 1, `draft_slug` TEXT NULL, `published` JSONB NULL (full copy incl. hidden blocks), `published_version`
    BIGINT NULL, `published_slug` TEXT NULL, `published_at` TIMESTAMPTZ NULL, `created_at`, `updated_at`, `updated_by`.
    Created lazily by GET (defaults: hero + jobs blocks, `classic`, `#7835DB`, slug null, seo nulls).
  - Slug ownership: a slug is taken when another company holds it as `draft_slug` or `published_slug`; serialize
    claims with `pg_advisory_xact_lock` on the slug inside the save tx, and keep DB uniqueness on each column.
  - `company_site_slug_history(slug PK, company_id, retired_at)`: previous published slugs (written by publish when the
    published slug changes). Never blocks a claim; a claim by another company deletes that history row. A company
    reclaiming its own old slug also deletes it.
  - `company_site_media(id UUID PK random, company_id FK, kind, storage_key, content_type, width, height, byte_size,
    created_at, created_by)`; media refs in the document must point to this company's rows with the matching kind
    (cover→hero.cover, story→story.image, gallery→gallery items, portrait→testimonial photo).
- **L7.** Frontend (verbatim): «En testimonials, `consent` es boolean en el borrador (un testimonio recién agregado se
  guarda con false). `true` solo se exige al publicar, como ya dice la tabla de requisitos. Aclaré la fila de contenido
  del contrato, que decía «must be true».» Draft save accepts `false`; publish requires `true`.
- **L8.** T3 independent verification (gentle-ai-verify, read-only): S6 FAIL, S8 FAIL — JPEG bytes after EOI survive
  (trailing metadata served publicly); WebP VP8X accepted without an image chunk and with canvas ≠ coded size; file cap
  checked only after buffering the part; rejected-upload tests do not assert storage/DB unchanged and quota has no
  concurrent test. Fix round 1 sent to the T3 worker.
- **L9.** T3 re-judgment round 1: S6 PASS, S8 PASS (all four L8 findings closed; no new severe findings). Remaining
  limitation stated by the verifier: WebP checks validate container/header policy, not compressed-pixel decodability; no
  fuzz campaign.
- **L10.** Native review review-47b0aca430de81b7 over T1–T3 (base 4e074e2e..bea083c2, lenses risk/resilience/
  reliability): approved and acknowledged (authority burned). Advisory, non-blocking (R3/R4 commit-compensation,
  `infrastructure/postgres/media.go:54-55`): when `tx.Commit` returns an error the outcome is ambiguous (the commit may
  have succeeded), yet the stored object is deleted, which could leave a row pointing at a missing file. Follow-up for
  the user, not fixed tonight.
- **L11.** T4 parent differential (shared public catalog parser): scratch worktrees of bea083c2 vs bea083c2 + T4
  working tree (removed afterwards). `publicjobs.ParseQuery` on 20 representative queries without company_id (q,
  work_mode, state/municipality, limit/cursor errors, unknown params, malformed escapes): identical results and errors
  (CompanyID field excluded). The base `publicJobsHandler_test.go` passes unchanged against the new code; the existing
  `Public|Jobs` integration flows pass. No unrequested difference.
- **L12.** T4 independent verification: S8 PASS; S7 FAIL on two points. (a) Timing: invalid-format slugs return 404
  before the DB query. Accepted as is, because invalid formats can never be stored and the shortcut reveals nothing
  about existing sites (bodies, status and headers are identical). (b) `TestPublicGeoSearchIndexCapability` fails on
  the long-lived test DB (:32768) even at base bea083c2, so it is pre-existing and depends on data state; it passes on
  a fresh DB. The parent's fresh-DB run surfaced a real T4 defect: `TestCompanySitePublicSnapshotHistoryAndLiveness`
  depends on geo catalog rows seeded by other tests (`companies_country_code_fkey`). A fixture-isolation fix was sent
  to the T4 worker.
- **L13.** T4 fixture fix verified by the parent: gofmt/vet clean, full unit suite (incl. scripts/closure) green, full
  `-tags=integration ./cmd/api` green on a fresh DB (:32771). S7 timing point accepted per L12(a); the geo planner test is
  pre-existing and data-state dependent (L12(b)).
- **L14.** Native review of the whole range 4e074e2e..67f83b6a was refused with `lens_context_budget_exceeded`, so T4
  was reviewed alone: review-c914ea96bd1c374e (bea083c2..67f83b6a, lenses risk/reliability) approved with no
  findings and acknowledged (authority burned). Together with review-47b0aca430de81b7 (T1–T3), every commit on the
  branch has an approved native review. A throwaway E2E environment for the frontend runs at 127.0.0.1:8090:
  binary from 67f83b6a, own Postgres container `peopleflow-careers-site-e2e`, PEM-mode JWT minted locally, and one
  published v2 vacancy for the seeded company. It is torn down when the frontend finishes.
- **L15.** Frontend live E2E against :8090 (verbatim): «`curl -i http://127.0.0.1:8090/v2/company-sites/nexo-e2e-1793076191425` → 500
  `{"error":"an internal error occurred","code":"internal_error"}`». Two causes. (1) The E2E seed gave companies a
  13-char RFC, so `GET /companies/{id}` also failed; a seed defect, not code. Fixed in the E2E data. (2) A real T4 defect:
  `VisibleDocument` validated twice, and the first pass canonicalizes `story.body` in place, so any published site with
  a visible story body answered 500. Fix: drop hidden blocks from the decoded value and validate once. Tests:
  `TestVisibleDocumentKeepsVisibleRichBody` (RED observed, then GREEN) and `TestCompanySitePublicProjectionRealRichWiring`
  (real draftjson + draftrich). Full unit suite and full integration green on a fresh DB.
- **L16.** User via frontend (2026-10-27, verbatim): «el usuario dice que podés bajar ya el entorno de :8090 (proceso,
  contenedor peopleflow-careers-site-e2e y /tmp/careers-site-e2e). Lo va a ver al final de la feature. También decidió
  que S3 se va a priorizar, pero como lo último de esta feature: por ahora no hay que tocar nada del adaptador de
  storage.» The E2E environment was torn down and verified: no :8090 listener, container removed, folder deleted. S3 is
  pending as the last unit of the feature; the storage adapter stays untouched until then.
- **L17.** Frontend (2026-10-27, verbatim): «encargo T7 (último de la feature company careers site), decidido por el usuario
  hoy. Decisiones (textuales del usuario): servir «Backend las sirve (Recomendado)»; local/integración «MinIO en Docker
  (Recomendado)»; alcance «Solo imágenes del sitio»; implementa «La sesión de backend». Alcance concreto: 1. Adaptador S3
  del puerto de storage de media del sitio (`internal/features/companysites/application/media.go` y su
  infraestructura), bucket PRIVADO; el endpoint actual `GET /v2/company-sites/media/{id}` lee de S3 y responde igual que
  hoy (content-type, nosniff, CSP sandbox, `Cache-Control: public, max-age=31536000, immutable`, 404 desconocido).
  Contrato: `docs/contracts/company-careers-site-v1.md` §3.4 (upload: magic bytes, ≤5 MB, 200–6000 px, strip EXIF) — sin
  cambios para el frontend. 2. Selección por config (env) entre disco (dev rápido, default actual) y S3; credenciales por
  la cadena estándar del SDK (rol IAM en despliegue), nunca en código/logs; región, bucket y prefijo por env; documentar
  los nombres de las variables. 3. Tests: unitarios del adaptador + integración contra MinIO con docker compose
  (put/get/head/not-found/content-type, objetos grandes, errores de red → error de dominio sin filtrar detalles). 4. Los
  CV de candidatos NO cambian (tarea aparte).» Backend decisions: aws-sdk-go-v2 (s3 + config) is the new dependency
  (named high-risk item 5 → independent verify); MinIO lives in a separate compose file so the user's running
  `peopleflow-vacancies` Postgres service in `backend/docker-compose.yml` is untouched.
- **L18.** T5 blocker: MinIO no longer distributes public images. Verified by the parent: `docker pull minio/minio` →
  «pull access denied for minio/minio, repository does not exist or may require 'docker login'»; quay.io/minio/minio →
  401 UNAUTHORIZED; ghcr.io → denied; busybox pulls fine, so it is not a network problem. Done and green: the
  aws-sdk-go-v2 S3 adapter, env config and their unit tests (worker, uncommitted). Asked the user via the frontend:
  build MinIO from source into a local image (recommended), another S3 emulator, or only a real S3 bucket later.
- **L19.** User decision via frontend (verbatim): «1. Compilar MinIO desde el código fuente». Frontend: «Seguí con esa opción:
  imagen local con un Dockerfile en el repo y compose aparte en backend/docker-compose.minio.yml, sin tocar
  docker-compose.yml. Fijá la versión con un tag o commit concreto del código fuente, no con main, para que la build sea
  reproducible.»
- **L20.** T5 independent verification: S9 FAIL. (1) High: the production custom-endpoint guard can be bypassed
  through endpoints the SDK inherits (`AWS_ENDPOINT_URL_S3`, `AWS_ENDPOINT_URL`, shared config); `site_media.go:53`
  checks only SITE_MEDIA_S3_ENDPOINT. (2) Medium: the documented IAM omits s3:ListBucket, so AWS answers 403 for absent
  keys, which maps to 500 instead of 404. (3) Medium: on disk a missing file returns 500, while S3 returns 404, so the
  two modes differ. (4) Medium: the bucket bootstrap helpers accept any endpoint and default credentials with no
  production guard. Fix round 1 sent to the T5 worker.
- **L21.** T5 re-judgment round 1: findings 1, 3 and 4 closed (inherited endpoints are scrubbed or rejected on the
  effective client options; disk and S3 return the same 404; bootstrap is guarded to loopback and non-production; the
  `testsupport` package is imported only by integration tests). Finding 2 remained open: a ListBucket grant
  conditioned on `s3:prefix` never applies to GetObject. The parent fixed it in `docs/site-media.md`: unconditional
  `s3:ListBucket` on the bucket ARN, plus a dedicated-bucket note, with 403 still mapped to storage-unavailable. That
  is doc-only and unverified against real AWS IAM. Parent checks: `go mod verify`, vet, full unit suite and the MinIO +
  Postgres integration packages are green. CV storage, `docker-compose.yml` and frontend are unchanged.
- **L22.** T5 committed as f03af5fe. Native review review-45d46a8ebda1fbff (443f55b0..f03af5fe, lenses
  risk/resilience/reliability): approved and acknowledged. Live S3 E2E brought up again for the frontend on :8090:
  binary f03af5fe in S3 mode against the source-built MinIO, a fresh Postgres, and a published vacancy. Upload → MinIO
  object → identical public bytes and headers; unknown id → 404; anonymous direct MinIO access → 403. Open: the
  IAM ListBucket guidance has not been verified against real AWS.
