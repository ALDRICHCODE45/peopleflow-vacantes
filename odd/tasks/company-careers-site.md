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
- **S8** (L2). Agreed amendments: media served by public `GET /v2/company-sites/media/{id}` (capability URL, immutable
  caching); old slug → 200 same §4.1 shape with current `slug`; published snapshot is a copy; `story.body` via
  `draftrich.ValidateDocument` + ≤ 5,000 code points; 412 `{error, code, current}`; identical PUT is a no-op; public
  read drops hidden blocks and unreferenced media; PUT body ≤ 1 MiB; ≤ 300 media per company (`media_limit_reached`);
  publish/unpublish audited; publish without If-Match → 428; EXIF stripped without re-encoding; `company.location` as in
  `GET /companies/{id}`.

## Tasks

- [x] T1 — S1, S4, S8: migration + document validation + GET/PUT draft + slug availability — route: worker — commit: (this commit)
- [ ] T2 — S5, S8: publish/unpublish (owner, issues, audit) — route: inline — commit: —
- [ ] T3 — S6, S8: media upload + public media read — route: inline — commit: —
- [ ] T4 — S7, S8: public site read + catalog company_id filter — route: inline — commit: —

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
