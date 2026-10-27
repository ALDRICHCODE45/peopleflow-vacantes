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
- [ ] T6 — S1–S11: dress editor and public site with the approved v0 design (L18–L19; source in `.v0-review-site/`),
  composed from installed shadcn primitives per `docs/frontend-ui-design-rules.md`, wired to the T3/T4 model, API and
  autosave (never v0's simplified model). Delivered in reviewable slices, each reviewed in the browser (looks, details,
  system design — not only behavior) from the review worktree (L20):
  - [x] T6a — fixture: `/v2/company-sites/{slug}`, media and `/v2/jobs?company_id=` in `tests/fixtures` — route: worker — commit: see L21
  - [x] T6b — public site: all 13 sections × variants, brand tokens + contrast, font pairs, header/footer, socials —
    route: worker — commit: cbdf943d (site), 579f24de (route without app header, L22)
  - [ ] T6c — editor shell on `/empresa/sitio`: tabs, section list (add/reorder/hide/duplicate/delete), live preview
    with device switch, properties panel, save status, owner/recruiter — route: worker — commit: —
  - [ ] T6d — section property forms (13) + image upload with crop — route: worker — commit: —
  - [ ] T6e — Marca and Configuración tabs (brand color/contrast, fonts, company data read-only, slug availability, SEO
    preview) + publish flow (checklist, confirm, success, unpublish) — route: worker — commit: —
  - [ ] T6f — remove the prototype editor/profile and prototype `/empresas/<uuid>` links; e2e on the fixture; docs — route:
    inline — commit: —
- [ ] T7 — S6: S3 storage adapter for site media (last task of the feature, L17) — route: backend — commit: —

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
- **L16.** First live frontend↔backend integration (worker mvq74uvk-8-3o1q → mvq78ggg-9-117g): opt-in
  `features/company-site/live/careers-site.live.test.ts` (skipped unless `PF_LIVE_API`; throwaway tokens only in the
  gitignored `frontend/test-results/live/env.sh`) against the backend's isolated `feat/company-careers-site @ 67f83b6a`
  on :8090 (own Postgres, own keys; the user's :3000/:8080 untouched). Passed: 1 GET/ETag, 2 PUT +1 and identical no-op,
  3 stale If-Match → 412 with `current` (too-long title and reserved slug are rejected locally by design, zero fetches),
  4 media PNG 201 / unsupported 415, 5 recruiter publish 403, owner 422 `block_incomplete` on the unconsented testimonial,
  then publish 200 with `published.version == draft_version`. Failed: 6 — `GET /v2/company-sites/<published slug>` → 500
  `internal_error` (reproduced by the parent with curl; unknown slug → 404). Reported to backend; steps 6–9 pending.
  Backend fixed it at `feat/company-careers-site @ bc23aa11` (two causes: its e2e seed had a 13-character RFC; and a real
  part (d) bug — `VisibleDocument` validated the snapshot twice and the first pass left `story.body` canonicalized, so
  every published site with a visible story answered 500; RED unit test before the fix). Parent re-ran the full live
  suite: steps 1–9 all pass (6 public found, hidden omitted, cover present, own jobs present, foreign empty; 7 old slug →
  moved; 8 foreign site isolated, publish 422 `company_logo_missing`; 9 unpublish → public 404). Offline the live file is
  skipped (exit 0). No frontend/backend contract mismatch found.
- **L17.** User (verbatim): «1. Vamos a priorizar s3 pero aun eso no lo haremos, sera lo ultimo de esta feature. 2. lo
  puede bajar ya, no he visto nada, lo vere al final. 3dame el prompt ppr favor, recuerda qud v0 no tiene acceso a este
  repo, no le puedes hablar de comppnentes, le puedes hablar de la linea visual del sustema, de su paleta de colores,
  etc.. tambien recuerda que v0 tiene libertad creativa, no le impongas un diseño especifico, solo debe ser moderno y
  tener como prioridad ux/ui.» Done: T7 (S3) added as the last task; backend tore down the :8090 environment (process,
  container, /tmp folder; tokens invalid) and the parent deleted the local token file; v0 prompt rewritten with no
  stack/component names, the real light/dark palette from `globals.css`, Inter, shape and comfort rules, full creative
  freedom (modern, UX/UI first), keeping only product rules (behaviors, section content and limits, exact copy).
- **L18.** v0 first result (chat iOHqDhovIts). The preview URL is private to the user's v0 account (the MCP token did not
  open it), so the parent pulled the source with the v0 MCP and ran it locally (production build on :3200 from
  `.v0-review-site/`, excluded in `.git/info/exclude`; a first attempt ran `next dev` inside `frontend/test-results/`,
  pegged the CPU and slowed the user's :3000 until it was stopped and moved). Reviewed with the Playwright MCP (turn
  taken from and released to Houndfe), light/dark, 1440/768/390, demo states. Strong: three-zone editor (sections ·
  live preview with device switch · properties with Contenido/Diseño), library panel with search, brand tab with swatches,
  custom hex, contrast warning showing the adjusted shade, font samples; slug + SEO search preview; honest empty
  placeholders and field errors; owner/recruiter publish gate; checklist with links; mobile editor as three tabs
  (Secciones / Vista previa / Editar); public site editorial, no overflow, one H1. Gaps: modals (library, checklist,
  confirm, success) pinned to the top-left, not marked as dialogs, no initial focus on «Cancelar»; success shows a modal
  plus a toast; save status not announced; «Completa todas las secciones visibles» does not say which; loading skeleton is
  generic and only covers the preview; variants only partly implemented (hero/story/figures/grids) and hero labels
  mismatched («Dividida» renders centered); values/benefits ignore the chosen icon (heart/star only); large empty gaps
  between public sections; no social links in the closing/footer; nested scroll on mobile. v0's data model differs from
  the contract (titles/text generic per section, Spanish icon names) — T6 keeps the design, uses the T3 model.
- **L19.** v0 second result (same chat), reviewed the same way (production build in `.v0-review-site/`, Playwright MCP
  turn taken/released). Fixed: overlays centered; checklist lists the incomplete sections with links; loading skeleton
  mirrors the whole editor; real variants for every section with live mini-preview thumbnails (e.g. Portada
  Dividida/Centrada, Historia Manifiesto/Con imagen, Valores Tarjetas/Principios); public site much richer (split hero,
  brand-tinted bands, card values/benefits with their own icons, testimonial and offices with photos, brand-colored
  closing banner, social links in closing and footer); both brand configs work (orange + Moderna, green + Editorial
  dark); visitor view has a brand switcher; no nested scroll on the mobile editor; no overflow. Still to fix in T6 (our
  rules, not design): overlays not marked as dialogs and initial focus not on «Cancelar»; success still a modal (we use
  toast + status line); save status not announced; «Vacantes abiertas» wrongly flagged as missing a title (optional);
  mobile «Cifras» breaks «Monterrey» mid-word in three narrow columns. Verdict: design approved as T6 base.
- **L20.** User (verbatim): «Bien hermano, Si, me parece un buen momento para iniciar los siguientes pasos, recuerda
  siempre tus prioridades: 1. Sigue tu system design, 2. Prioriza siempre una ux/ui pulida 3. Siempre componentes de
  shadcn, revisa la documntacion oficial y ocupa los ejemplos que expone 4. en la revision en el navegador, no solamente
  validez que funciona, tambien valida que realmente se vea bien, valida los pequenos detalles que hacen la diferencia,
  valida que siga tu system design, me sigues?» Review builds: «Worktree aparte para revisión (Recomendado)» —
  `/home/aldrich_coder45/Desktop/workspace/peopleflow-vacantes-review` (detached, same clone), own `.next` and
  `node_modules`, served on :3100 against the fixture on :4010; the user's :3000 is never touched.
- **L21.** T6a (worker mvqqca6j-a-6zpz): `tests/fixtures/company-sites.mjs` + `jobs-server.mjs` — Nexo Labs site with all
  13 blocks validated by the product's public decoder, old slug `nexo-equipo`, media served from the repo's licensed
  `public/company/acme-cover.webp` (illustrative, the same photo for every role), 7 Nexo vacancies filtered by
  `company_id`, controls `/__site?brand=orange&font=modern | brand=green&font=editorial | jobs=empty|default`, `/__reset`.
  RED 4 → GREEN 11/11. The fixture pages jobs 2 + 5, which exposed that `listCompanyJobs` reads only the first page —
  sent to the T6b worker as a product fix (follow `next_cursor`).
- **L22.** First browser review of T6b (production build in the review worktree against the fixture): one H1, no
  overflow, no broken images, fonts per pair, mobile stats fixed. Sent back: gallery images with empty `src`; header nav
  wrapping 13 anchors into three rows; full-width hero CTA; mixed foregrounds on brand surfaces; empty white video idle
  state; heavy job cards. Fixture gained `COMPANY_SITE_FIXTURE_IMAGES` (local, uncommitted review photos). User decision
  on the PeopleFlow header (verbatim): «Estoy de acuerdo con tu opcion recomendada: Sitio de la empresa solo, sin
  embargo, me gustaria que en algun lugar, aparezca alguna referencia a peopleflow, algo sutil, algo como powered by
  PeopleFlow o algo asi, y un enlace a peopleflow para empresas, me sigues? algo muy sutil, tal vez en el footer, pero
  que no se pueda quitar, tal vez despues vemos si se pueda quitar pagando.» → `/empresas/<slug>` renders without the
  PeopleFlow app header; the site footer always shows «Impulsado por PeopleFlow» linking to `/` (no companies landing
  yet — backlog); removal as a paid option is a future decision.
- **L23.** Second browser pass of T6b (realistic local photos, light/dark, 1440/768/390, both brands): single-row
  nav with «Más», hero actions, compact equal-height job cards, footer credit «Impulsado por PeopleFlow» → `/`, no
  PeopleFlow navbar, exactly one main, framed not-found; the blank gallery of pass 1 was a lazy-loading artifact of a
  full-page capture (all 6 images load when scrolled). Remaining polish sent back: closing CTA alignment/weight,
  in-page anchors using the external arrow, dangling separators in wrapped job meta + search/filters on one row, video
  canvas misaligned and small play glyph, social links indented by button padding. `PublicShell` has no production
  caller left → remove in T6f.
- **L24.** Third and fourth browser passes of T6b: the five polish items verified; axe-core 4.13 found brand text below
  4.5:1 (eyebrows, links) on page and tinted bands, and a duplicate nav name — fixed with a separate brand-text token
  derived per surface and theme (`public/theme-tokens.ts`) and closing socials as a plain list. Re-run: axe 0 violations
  in orange light/dark, green light/dark and orange 390; no failed requests; empty jobs state checked. Full suite
  7453/7453 (1 skipped), typecheck clean, lint 13 pre-existing warnings, fixture 11/11.
- **L25.** T6b committed (cbdf943d, 579f24de); native assess from dbdf9fe6: medium, review not due. T6c started: the
  editor worker found the public renderer is an async server component (geo via `server-only`) and the draft carries
  no company identity or jobs → approved: extract a shared client-compatible `CompanySitePresentation` (server wrapper
  keeps geo/jobs resolution, public output identical) and pass `preview: { company, jobs, officeLabels }` loaded by the
  route. Fixture worker adds the authenticated draft endpoints. Editor browser review needs an employer session: user
  chose (verbatim) «Inicias sesión una vez y guardo la sesión (Recomendado)». Cognito's callback is registered only for
  `http://localhost:3000`, so the user logs in on their dev server and the session cookie (host-scoped, same
  `NEXTAUTH_SECRET`) is reused by the review build served on `localhost:3100`; state saved to the git-ignored
  `frontend/test-results/.auth/employer.json`, never logged or committed.
- **L26.** Employer session captured: the user logged in on `localhost:3000` (their dev server's API at :8080 was
  down, hence «no hubo ninguna respuesta del servidor» on the dashboard — unrelated to the session). Only the five
  `localhost` cookies were written, via an isolated Playwright context, to `frontend/test-results/.auth/employer.json`
  (mode 600, git-ignored); no token passed through the conversation. Review builds must run on `localhost:3100` with
  `NEXTAUTH_URL=http://localhost:3100` so the host-scoped cookie applies. Cognito tokens expire; if the session lapses,
  the user logs in again.
- **L27.** Fixture draft endpoints (worker mvqsi4j4-i-wjq3): in-memory authenticated draft for Nexo Labs under
  `/v2/me/company/site` — versioned PUT with If-Match/412 `version_conflict` + `current`, validation with the product's
  own `model.ts`/`defaults.ts`/`slug.ts` (transpiled in memory by `site-product-model.cjs`, no build output), publish
  into the public snapshot, multipart media upload served by the public media route. Controls
  `/__site-draft?role=owner|recruiter | conflict=next | offline=next | mode=new | gate=forbidden|company_inactive|none`,
  `/__reset`. RED 6 → GREEN 18/18.
- **L28.** T6c route wiring: authenticated data cannot be loaded while rendering a Server Component here —
  `getActionAccessToken()` refreshes and writes session cookies, which only server actions may do, and every `(empresa)`
  route loads through client-invoked server actions. Decision: follow that pattern — a route-local server action
  `loadCareersEditor()` (company always from the session, discriminated result, no raw errors) called by a client
  loader that shows the editor skeleton, then the editor or a StateCard per failure; no route-level `loading.tsx`
  (Next 15 #83386). No auth/session changes in this feature.
- **L29.** First editor review (production build on `localhost:3100`, saved employer session, fixture draft): the
  `(empresa)` layout needs `GET /v2/me` and `GET /me/company`, which the fixture lacked («No pudimos cargar tu cuenta»)
  → added (test-first, 19/19). Editor loads end to end. Sent back: desktop preview rendered the mobile layout (needs a
  real-width scaled iframe), page scroll plus three inner scrolls, selection scrolls the whole page (mobile loads
  scrolled 348px), duplicate «Sitio de empleo» H1, tall rows with wrapped lock and truncated names, variant thumbnails
  rendered as 16px icons, brand-colored selection outline, washed-out disabled «Publicar».
