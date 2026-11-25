# Careers site sections v2 — slice A (backend)

Backend half of slice A of the careers site Phase 3 (user-approved, relayed by the frontend session 2026-11-25).
Branch `feat/careers-site-sections-v2-backend` (worktree `../peopleflow-vacantes-careersv2`). Frontend on its own branch
`feat/careers-site-sections-v2`; it emits no new keys until this slice is in main. Slices B (hero MP4 video) and C
(public «Dejar mi CV») are out of scope here.

## Specs

- **S1** Slice A as proposed by the frontend (verbatim copy of its §«Slice A», file
  `peopleflow-vacantes-frontend/odd/tasks/careers-site-sections-v2-contract.md`):

  > ## Slice A — document additions (no migration; JSONB document)
  > 
  > 1. New variants on existing types (Go `rules[type].variants`, zod `z.enum`, contract table):
  >    - `hero`: `background_loop` (02, «Fondo en movimiento»; needs slice B, publish-blocked without a video),
  >      `photo_jobs` (03, «Foto con vacantes recientes»), `collage` («Collage de fotos», up to 3 images).
  >    - `benefits` / `values`: `bento` (02), `big_icons` (02).
  >    - `metrics` (Cifras): `brand_band` (big numbers on the brand band; count-up is presentation only).
  >    - `testimonials`: `carousel` (03, large photo; an item may carry an optional `video_url` YouTube/Vimeo — reuse the
  >      existing video URL validation).
  >    - `gallery`: `photo_strip` (03, moving strip; respects reduced motion in presentation).
  > 2. New section types (each: Go rule + `PublishIssues` case, zod `blockSchema` + `storedBlock`, contract rows):
  >    - `team` («Equipo / Líderes»): `title`, `intro`, items ≤ 12 {name ≤ 80, role ≤ 80, photo media (kind `portrait`), consent
  >      bool like testimonials}; variants `grid`, `portraits`.
  >    - `logos` («Logos / Reconocimientos»): `title`, items ≤ 12 {name ≤ 80, image media (new kind `logo`, PNG/WebP with
  >      alpha allowed, min 64 px — needs the kind CHECK relaxed, tiny migration), optional caption ≤ 80}; variants `strip`, `grid`.
  >    - `areas` («Áreas de trabajo»): `title`, `intro`, optional per-area overrides {area key from `PROFESSIONAL_AREA_OPTIONS`,
  >      icon or photo media}; the areas themselves are derived from the published vacancies (`professional_area`), no new
  >      data; variants `icon_cards` (02), `photo_cards` (03). Publish rule: none beyond title.
  >    - `talent_cta` («Llamado a talento»): `title`, `text`, `button_label ≤ 24`; variants `banner`, `split`. Its form needs
  >      slice C; until C ships the block is accepted but not offered in the editor.
  > 3. Per-block `style` (allowed envelope key next to `id,type,variant,hidden,content`; missing → defaults on read):
  >    `{ background: "default" | "tint" | "brand" | "image", spacing: "compact" | "airy", align: "center" | "start",
  >    overlay: "soft" | "medium" | "strong" | null, image: media ref | null }` — `image` required iff `background = "image"`,
  >    validated through `v.media` (ownership check). Curated values only (S3), never free values.
  > 4. Hero buttons: `primary_label ≤ 24` (default «Ver vacantes»), `secondary_visible` bool (default true),
  >    `secondary_label ≤ 24` (default «Conoce la empresa»), `secondary_target` = block id of a visible block or null (default:
  >    first block after the hero). Missing → defaults on read.

- **S2** Backend adjustments (agreed with the frontend in L2):
  - `secondary_target` must be the id of a block present in the document (else `validation_error`); at publish, a
    target that is hidden is a publish issue; missing key → null on read (= first block after the hero).
  - `team` items follow the testimonials consent rule exactly (same publish issue when consent is false).
  - `areas` overrides: area key must be one of the professional area catalog keys the backend validates vacancies
    with; duplicate keys rejected; exactly one of icon / photo per override.
  - `style.overlay` and `style.image` must be null unless `background = "image"`; `image` required when it is.
  - The new media kind `logo` needs a migration relaxing the kind CHECK (next free number); guarded Down that refuses
    while `logo` media exists.
  - Every new key is optional on read with the documented defaults, so existing stored documents stay valid and
    byte-identical when re-read except for the added defaults (document which).
- **S3** Contract: dated additive amendment in `docs/contracts/company-careers-site-v1.md`, same pattern as §2.2.

## Tasks

- T1 S1-S3 — slice A (writer) — done, uncommitted (L3)
- T2 — suite, merge, notify frontend — pending

## Log

- **L1** 2026-11-25, frontend session: «the user approved Phase 3 of the careers site (company-site), and slice A of a
  contract change is needed [...] Questions: (a) can you take slice A? (b) does the shape work for you or would you
  adjust anything (names, limits, defaults-on-read)?»
- **L2** 2026-11-25, backend: accepted with the S2 adjustments (sent to the frontend).
- **L3** 2026-11-25, writer (T1), implemented to S1–S3 as overridden by L4. Contract: dated amendment
  `docs/contracts/company-careers-site-v1.md` §2.3 (exact JSON, limits, error table, publish issues, media kind) plus
  §3.3/§3.4 pointers; backend doc `backend/docs/site-media.md` «Kinds and image rules».
  - RED (observed before implementation, behaviour level with compile stubs): 13 application tests, the logo upload
    handler test (`kind invalid` 400) and 5 cmd/api route tests failed; `TestCompanySiteAreasMatchVacancyCatalog`
    passed from the start (parity guard). The L4 rework (wire rule, `video_url`, `overrides`, issue renames,
    `style_image_missing`) was coded before its tests were rewritten, so it has no separate RED. Migration 00066 was
    written before its integration test; the test asserts the pre-00066 refusal of `logo` in-database instead.
  - Migration **00066** `company_site_logo_media`: kind CHECK + `logo`; width/height CHECKs 64 px for `logo`, 200 px
    otherwise (same constraint names); new `company_site_media_logo_format_check` (PNG/WebP); Down refuses while any
    `logo` row exists. `make gate-sqlc` pass (no query change).
  - Defaults added on read: **none** (L4 §9). `style`, the hero keys and `video_url` stay absent when absent (on PUT
    canonicalization, GET draft, publish and GET public); validation/publish treat absent as defaults. A present
    `style` is filled to its five keys; `style: null` and `images: null` normalize to absent / `[]`. New block types
    normalize like all blocks (strings `null`, lists `[]`). Stored v1 fixtures re-read byte-identical (unit, route and
    Postgres integration tests).
  - Totals: unit `make test PKG="./cmd/api/ ./internal/features/companysites/... ./db/migrations/"` 264 top-level
    PASS; integration (throwaway postgres:16 on 127.0.0.1:55466, same packages) 816 PASS / 0 FAIL / 6 SKIP (S3 needs
    `SITE_MEDIA_S3_TEST_ENDPOINT`). 27 new top-level tests. One earlier full cmd/api integration run failed
    `TestPublicGeoSearchIndexCapability` (query-plan assertion on vacancy indexes, untouched here); it passed on the
    rerun. gofmt clean, go vet (plain and `-tags=integration`) clean, archguard only the allowed `docker/minio`.
  - Deviations / choices: testimonial key is `video_url` (L4), validated by a Go port of the editor's
    `parseVideoUrl` (explicit ports rejected); areas use `content.overrides[]` with `key` (L4); override photo,
    collage images = kind `gallery`, `style.image` = kind `cover`; `logo` uploads reject JPEG (415); stored reads null
    a dangling `secondary_target` (the public projection drops hidden blocks); `style_image_missing` only for visible
    blocks; team/logos reuse `block_incomplete`; areas/talent_cta need `title` only. The area catalog is a copy of the
    vacancy `professional_area` literals (`application.ProfessionalAreas`), parity pinned in cmd/api.
- **L4** 2026-11-25, frontend assumptions (its zod model) and backend answers — these OVERRIDE S2 where they differ:
  1. `style` default `{background:"default", spacing:"airy", align:"start", overlay:null, image:null}`; each missing
     key → its default; `overlay` may be null even with `background:"image"` (S2 «overlay must be null unless image»
     stays: overlay non-null only allowed with background image).
  2. Collage: hero content `images: [{media_id}]` max 3, default []; publishing `collage` needs ≥ 2 images.
  3. Hero labels nullable (blank → null; public falls back to «Ver vacantes» / «Conoce la empresa»).
     `secondary_target` may NOT point to the hero itself (validation_error). A hidden target blocks publish only when
     `secondary_visible` is true.
  4. Testimonial `video_url`: URL string ≤ 500 validated exactly like the video block.
  5. areas `overrides: [{key, icon|null, photo|null}]` max 16, icon from the existing ICONS set, exactly one of
     icon/photo, unique keys.
  6. Limits: team/areas title 80, intro 200; logos title 80; talent_cta title 80, text 240, button_label 24 (default
     «Dejar mi CV»).
  7. Publish: team ≥ 1 item, every item with name + consent (photo optional); logos ≥ 1 item, every item with name +
     image; areas/talent_cta title only. Issue codes: `hero_video_missing` (field `blocks[i]`),
     `secondary_target_hidden` (field `blocks[i].content.secondary_target`), `hero_collage_images_missing`,
     `style_image_missing` (field `blocks[i].style.image`), plus the existing consent/title code names reused for team
     and logos (document them).
  8. Missing style image with `background:"image"` is a PUBLISH ISSUE (`style_image_missing`), not a 400 on save
     (overrides S2).
  9. Deployment order (overrides «defaults on read» in S1/S2 for the WIRE): GET must NOT add new keys to a stored
     document that does not contain them (old strict frontend readers reject unknown keys). Absent new keys stay absent
     in responses; the frontend applies the defaults. New keys appear only once a client saved them. Validation and
     publish logic treat absent keys as their defaults.
