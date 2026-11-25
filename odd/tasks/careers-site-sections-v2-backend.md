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

- T1 S1-S3 — slice A (writer) — pending
- T2 — suite, merge, notify frontend — pending

## Log

- **L1** 2026-11-25, frontend session: «the user approved Phase 3 of the careers site (company-site), and slice A of a
  contract change is needed [...] Questions: (a) can you take slice A? (b) does the shape work for you or would you
  adjust anything (names, limits, defaults-on-read)?»
- **L2** 2026-11-25, backend: accepted with the S2 adjustments (sent to the frontend).
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
