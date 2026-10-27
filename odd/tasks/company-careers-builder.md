# Company careers-site builder (editor + public site), replacing the prototype

Replaces the local-only `/empresa/sitio` editor and the prototype `/empresas/[companyId]` («Acme») page with a real,
persisted, publishable block-based careers site. Design comes from v0 (prompt: `docs/design/v0/prompts/company-careers-builder.md`);
tonight's work is the base without UI (contract, model, state, autosave, minimal renderer) so the v0 design can dress it.

## Specs

- **S1** (L2). Editor model: «Bloques curados con variantes» — add, reorder, hide and edit predesigned blocks, each with
  2–3 layout variants; no free canvas. Hero and «Vacantes abiertas» are always present (reorderable, not removable).
- **S2** (L2). Blocks in v1 (all four groups chosen): Portada, Historia, Misión y valores, Vacantes abiertas, Cierre;
  Beneficios, Cifras, Proceso de selección; Galería de cultura, Testimonios, Video; Oficinas/ubicaciones, Preguntas
  frecuentes. Field limits per block are in the v0 prompt «Block library» and are the validation contract.
- **S3** (L2). Branding: «Logo, portada, color y fuentes curadas» — brand color with automatic contrast check and 3
  curated font pairings, inside the design system.
- **S4** (L2). Publication: «Borrador + Publicar, URL /empresas/<slug>» — autosaved draft; the public page shows the last
  published version; editable slug; «Ver como visitante» previews the draft.
- **S5** (L3). Editor layout is left to v0's creative proposal; the prompt only fixes functional requirements.
- **S6** (L3). Images: «Subida real a S3 con recorte» (logo, cover, gallery, testimonial photos) — presigned upload like
  CVs, type/size validation, crop.
- **S7** (L3). Video: «Solo embebido de YouTube/Vimeo», loaded on click.
- **S8** (L4). Permissions: «Owner publica; reclutadores editan borrador».
- **S9** (L4). Company data: «Una sola fuente: el sitio los lee del perfil» — name, logo, description, socials come from the
  company profile (`/me/company`); the site stores only its own content (blocks, brand, slug, SEO).
- **S10** (L4). Prototype: «Reemplazarlos por completo» — remove the local editor and the Acme prototype company;
  `/empresas/<slug>` renders only real published sites, anything else is 404.
- **S11** (L4). Jobs block: «Vacantes publicadas reales + filtros» — live published vacancies of the company with search and
  modalidad/ubicación filters, each linked to its real detail; needs the public catalog filtered by company (backend).
- **S12** (L3). Tonight: «Base sin UI + prompts de v0» — backend contract, block model and validation, editor state,
  autosave and a minimal renderer with tests; the v0 design dresses it afterwards.

## Tasks

- [x] T1 — S1–S11: v0 prompt (editor + public site) — route: inline — commit: 0513e22e
- [x] T2 — S4, S6, S8–S11: backend contract proposal, agreed with the backend session (site document, slug, publish,
  upload, public read, catalog by company) — route: inline + backend session — commit: this commit (agreed `docs/contracts/company-careers-site-v1.md`; backend implements on `feat/company-careers-site`)
- [x] T3 — S1–S3, S7: block model (zod schemas, limits, defaults, contrast check, slug rules) with tests — route: worker — commit: see L8
- [x] T4 — S1, S4, S8: editor state (reducer: add/reorder/hide/variant/edit, selection, dirty) and autosave client
  (debounce, ETag/412, status) with tests — route: worker — commit: see L9
- [x] T5 — S10, S11: minimal public renderer + `/empresas/[slug]` route on the contract (404 for unpublished/unknown,
  308 for an old slug), media proxy from the frontend origin, Acme public route and its navbar link removed — route:
  worker — commit: see L13 (route removal 277c7edf)
- [ ] T6 — S1–S11: dress editor and public site with the v0 design (after the user hands it over); the new editor replaces
  the prototype local editor (`features/company-site-editor`, `features/company-profile`) at that point — route: TBD — commit: —

## Log

- **L1.** User (verbatim): «Bien hermano, lo que tengo en mente es pasar a la seccion de creacion de la web de la empresa,
  no te voy a mentir, no me gusta nada el estado actual, es pesimo, sin ofender, aparte de que no funciona nada. No me
  gusta ni el editor ni tampoco el preview actual del "resultado" asi que quiero disrñar contigo este apartado, platicar
  sobre decisiones clave, dejar todo decidido para yo irme a dormir y dejarte implementando, despues de que terminemos
  las decisiones, la primera base del diseño tanto del editor como del resultado, se las pasare a v0, despues te las paso
  a tí y trabajamos sobre ello, tu me daras el prompt ( ya sabes como) y despues seguimos. pero te adelanto, quiero algo
  mas de lo que hay ahora, mas cosas, mas profesional... escucho propuestas»
- **L2.** Decisions, round 1: «Bloques curados con variantes (Recomendado)»; blocks: all four groups selected; «Logo,
  portada, color y fuentes curadas (Recomendado)»; «Borrador + Publicar, URL /empresas/<slug> (Recomendado)».
- **L3.** Round 2: layout — «No crees que eso se lo debemos dejar a la propuesta de v0 ya que tendra librrtad creativa?»
  (agreed); «Subida real a S3 con recorte (Recomendado)»; «Solo embebido de YouTube/Vimeo (Recomendado)»; «Base sin UI +
  prompts de v0 (Recomendado)».
- **L4.** Round 3: «Owner publica; reclutadores editan borrador (Recomendado)»; «Una sola fuente: el sitio los lee del
  perfil (Recomendado)»; «Reemplazarlos por completo (Recomendado)»; «Vacantes publicadas reales + filtros
  (Recomendado)».
- **L5.** Current state (2026-10-26): editor `features/company-site-editor` keeps the draft in React state only; public
  `/empresas/[companyId]` reads `PROTOTYPE_COMPANY_PROFILES` + `ACME_PROTOTYPE_JOBS`. Backend has the company profile
  (`PATCH /me/company`: name, website, logo_url, description, size, founded_year, location, linkedin/instagram/facebook/
  twitter, cover_image_url — URLs only) and public `GET /companies/{id}`; no site sections, slug, publish state or image
  upload.
- **L6.** User: backend — «Sí: acordalo con backend e implementen los dos (Recomendado)»: the backend session implements
  the contract on its own branch tonight; nobody merges to main or pushes; the user reviews in the morning.
- **L7.** Backend (01a16b3c) accepted the contract with 12 changes (contract §6): API-relative public capability media
  URL `/v2/company-sites/media/{id}` (no S3 adapter yet; flagged for the user), old slug → 200 with current `slug` and
  frontend 308, published snapshot as a copy, story body reuses `draftrich.ValidateDocument`, uniform 412 envelope,
  identical PUT is a no-op, public read drops hidden blocks, limits (1 MiB body, 300 media), audit events, EXIF stripped
  without re-encoding. Worker T3 (mvq388ml-2-o9d1) asked two contract questions; parent decided: per-block publish
  requirements table (§2.1) and video stored as `{provider, video_id} | null`. Both sent to backend.
- **L8.** T3 (worker mvq388ml-2-o9d1 → mvq3b0nl-3-nvhe): `features/company-site/` model.ts (13 block schemas, draft vs
  publish), slug.ts, video.ts, brand.ts (WCAG contrast, adjusted brand shade, 3 font pairs), defaults.ts (library labels,
  standard benefits); RED (missing modules) → GREEN 187. Parent review found `consent: z.literal(true)` at save level,
  which would break autosave on a fresh testimonial; contract says consent is a publish requirement → `z.boolean()` +
  publish test (RED 2 → GREEN 188); contract row clarified and sent to backend. tsc, eslint clean.
- **L9.** T4 (worker mvq3mzc6-4-t8tc): `api/` (server-only client: If-Match, ETag must equal `"draft_version"`, redirect
  error, zod-decoded success/error envelopes, network/timeout → uncertain; server actions read the token from the server
  session), `editor-state.ts` (reducer; field errors keyed by block id), `autosave.ts` + `use-autosave.ts` (1.5 s
  debounce, one save at a time, in-flight edits survive a 200, 412 stops autosave and keeps local edits, offline resumes
  only on `online` or the next edit — no timer retries), `permissions.ts` (owner-only publish). RED → GREEN 243 (55 new);
  tsc, eslint clean. Parent read actions/client/autosave. Media upload is a typed stub until the backend's media part.
  Slice boundary: the branch is past ~400 lines; delivery is commit-by-commit review, each T# its own commit.
- **L10.** Plan change (parent): the prototype editor is removed in T6, together with the arrival of the new editor —
  removing it in T5 would leave `/empresa/sitio` empty until the v0 design lands. T5 keeps the public side only.
- **L11.** Backend part (a) ready: `feat/company-careers-site` @ ee16597b — migration 00047, GET site (lazy create), PUT draft,
  slug availability; unit + integration green. PUT: 428 without If-Match; 400 `invalid_request` for malformed If-Match or
  JSON; 413 > 1 MiB; field codes too_long/required/invalid/unknown_key/duplicate/not_allowed; blank strings return null,
  story body stored canonical. Frontend gap (minor): the T4 error schema lacks `invalid_request` (decoded as unrecognized;
  the client already prevents both causes) — add with the media upload work.
- **L12.** Backend part (b) ready: `feat/company-careers-site` @ a7c34f17 — publish (owner, If-Match required, 412 with
  `current`, 422 `publish_blocked` issues with `field` null for no_content_block/company_logo_missing/company_name_missing,
  409 `slug_taken` if another company took the slug meanwhile) and unpublish (owner, idempotent); both 200 with the §3.1
  shape; logo/name read from `companies`; old slug moves to history on republish. Asked whether publish's 409 carries
  `field: "slug"` (the frontend decoder requires it) — confirmed: same writer as the PUT, `{"error","code":"slug_taken","field":"slug"}`.
- **L13.** T5 (worker mvq3znsp-5-jcuw → mvq40wnd-6-j32c; parent removed the old `[companyId]` route, 277c7edf, because
  the worker may not delete files): `public/` (read.ts: found/notFound/moved/unavailable, invalid slug never fetched;
  jobs by `company_id` via the shared list decoder; `CompanySitePage` with header anchor nav, all 13 blocks, one H1,
  brand CSS variables from the adjusted color, click-to-load YouTube-nocookie/Vimeo player, client jobs filters with
  empty/no-results StateCards; office labels via the server geo catalogs), route `/empresas/[slug]` (404, 308 for an old
  slug, error boundary, SEO metadata), media proxy `/media/sitios/[id]` (UUID check, API origin only, credentials omit,
  redirect error, image/jpeg|png|webp only, nosniff, deadline through the body), navbar «Empresas» prototype link
  removed. RED → GREEN 54 public + 36 navbar. Parent: reviewed the proxy; removed the prototype e2e
  `company-careers.spec.ts`; README/CSS comments updated. Full Vitest found 7 guardrail failures: `requestPath.test.ts`
  (new fetch/transport callers and route handler must be listed — added, plus a dedicated proxy-guard test) and
  `PublicShell.test.tsx` (expected the prototype «Empresas» link — now asserts there is none). Remaining prototype-only
  `/empresas/<uuid>` links in `JobDetailView` (prototype branch) and `VacancyCard` (`companyHref`, no real caller) go
  with the prototype cleanup in T6. Jobs filters cover the first catalog page only. Full Vitest 7306/7306, tsc clean.
- **L14.** Native review of the whole branch exceeded the reviewer context (`lens_context_budget_exceeded`); reviewed
  T4+T5 alone with base 269f16a4 (T3, already approved): approved with two non-blocking warnings at `autosave.ts:34`
  (reliability, resilience): after an uncertain save, reverting to the last confirmed document was treated as clean and
  never saved, though the server may hold the unconfirmed one. Fixed with an `unconfirmed` flag (set on uncertain, cleared
  on success/conflict): RED 1 → GREEN 273.
  Backend part (c) ready: `feat/company-careers-site` @ bea083c2 (independent security verifier PASS on the 2nd pass) —
  `POST /v2/me/company/site/media` multipart exactly `kind` + `file` (anything else 400 `invalid_request`), 201
  `{id, kind, url, width, height, content_type}`, 413/415 (also animated or malformed WebP)/422 image_too_small,
  image_too_large, media_limit_reached, 503 when file storage is not configured; metadata stripped without re-encoding.
  `GET /v2/company-sites/media/{id}`: immutable public caching, nosniff, `CSP: default-src 'none'; sandbox`; 404 no-store.
  Frontend follow-ups: the media upload client (T4 stub) must send exactly `kind` + `file` and map 400 `invalid_request`
  and 503; the proxy could also forward the API's CSP header.
- **L15.** Media upload (S6, worker mvq5xscl-7-su8e): same-origin `POST /api/company/site/media` (origin/sec-fetch-site
  CSRF check, server-session token, bounded body via the CV `readBoundedBody`, exactly `kind` + `file`, type/size checks,
  sanitized filename) → server-only `api/file-client.ts` → backend multipart; `upload.ts` browser helper with client
  pre-validation and Spanish messages, uncertain never retried; `invalid_request` added to the site error schema (L11
  gap); `requestPath.test.ts` registers the route/caller with a dedicated guard. Crop stays with the v0 design (T6).
  RED → GREEN 369 focused (49 new); full Vitest 7356/7356; tsc clean; lint 0 errors. Parent read the route.
