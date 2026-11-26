# Careers site sections v2 — backend contract proposal (draft for the backend session)

Source: `odd/tasks/careers-site-sections-v2.md` (S1–S4, L3–L4) and the chosen designs
`design/careers-site-sections-v2/02-bento-moderno.html`, `03-humano-fotografico.html`, `07-editor-biblioteca-y-estilo.html`.
Proposed as dated amendments to `docs/contracts/company-careers-site-v1.md` (same pattern as §2.2: additive, missing keys
normalized on read, no data migration for the document). Backend ships each slice first; the frontend never emits new
keys before the backend accepts them (old strict validators reject unknown keys/variants).

Three slices, ordered by risk; each one is independently shippable.

## Slice A — document additions (no migration; JSONB document)

1. New variants on existing types (Go `rules[type].variants`, zod `z.enum`, contract table):
   - `hero`: `background_loop` (02, «Fondo en movimiento»; needs slice B, publish-blocked without a video),
     `photo_jobs` (03, «Foto con vacantes recientes»), `collage` («Collage de fotos», up to 3 images).
   - `benefits` / `values`: `bento` (02), `big_icons` (02).
   - `metrics` (Cifras): `brand_band` (big numbers on the brand band; count-up is presentation only).
   - `testimonials`: `carousel` (03, large photo; an item may carry an optional `video_url` YouTube/Vimeo — reuse the
     existing video URL validation).
   - `gallery`: `photo_strip` (03, moving strip; respects reduced motion in presentation).
2. New section types (each: Go rule + `PublishIssues` case, zod `blockSchema` + `storedBlock`, contract rows):
   - `team` («Equipo / Líderes»): `title`, `intro`, items ≤ 12 {name ≤ 80, role ≤ 80, photo media (kind `portrait`), consent
     bool like testimonials}; variants `grid`, `portraits`.
   - `logos` («Logos / Reconocimientos»): `title`, items ≤ 12 {name ≤ 80, image media (new kind `logo`, PNG/WebP with
     alpha allowed, min 64 px — needs the kind CHECK relaxed, tiny migration), optional caption ≤ 80}; variants `strip`, `grid`.
   - `areas` («Áreas de trabajo»): `title`, `intro`, optional per-area overrides {area key from `PROFESSIONAL_AREA_OPTIONS`,
     icon or photo media}; the areas themselves are derived from the published vacancies (`professional_area`), no new
     data; variants `icon_cards` (02), `photo_cards` (03). Publish rule: none beyond title.
   - `talent_cta` («Llamado a talento»): `title`, `text`, `button_label ≤ 24`; variants `banner`, `split`. Its form needs
     slice C; until C ships the block is accepted but not offered in the editor.
3. Per-block `style` (allowed envelope key next to `id,type,variant,hidden,content`; missing → defaults on read):
   `{ background: "default" | "tint" | "brand" | "image", spacing: "compact" | "airy", align: "center" | "start",
   overlay: "soft" | "medium" | "strong" | null, image: media ref | null }` — `image` required iff `background = "image"`,
   validated through `v.media` (ownership check). Curated values only (S3), never free values.
4. Hero buttons: `primary_label ≤ 24` (default «Ver vacantes»), `secondary_visible` bool (default true),
   `secondary_label ≤ 24` (default «Conoce la empresa»), `secondary_target` = block id of a visible block or null (default:
   first block after the hero). Missing → defaults on read.

## Slice B — hero video upload (migration + streaming; risk item 1/5)

- Media: new kind `hero_video`, `content_type` `video/mp4`, cap 20 MB, duration ≤ 30 s, width/height nullable for video
  (or parsed from `moov`), `duration_ms` column; validation by `ftyp` brand (isom/mp42/avc1) + `moov` parse. No ffmpeg:
  codec/audio can't be verified; presentation always plays muted, looped, `playsinline`, paused under reduced motion.
- Hero content `background_video: media ref | null` + existing `cover` as required poster.
- Serving: Range/206 support (`http.ServeContent` over a seekable reader or S3 ranged GET — storage port change); the Next
  proxy `app/media/sitios/[id]/route.ts` forwards `Range` and returns `206`, `Content-Range`, `Accept-Ranges`, allows
  `video/mp4`. Streaming upload instead of reading 20 MB into memory.
- Decided (2026-11-26): no ffmpeg — the backend image stays as is; validation stays structural; the poster is the hero `cover` the person uploads.

## Slice C — public «Dejar mi CV» into the talent base (migration + anonymous endpoint; risk items 1/2)

- Route `POST /v2/company-sites/{slug}/talent` (multipart, anonymous): only when the site is published and has a visible
  `talent_cta` block. Fields: name, email and/or phone, residence, education level (required, as manual intake), areas of
  interest (from `PROFESSIONAL_AREA_OPTIONS`), CV PDF/DOCX ≤ 5 MiB via `cvs.Inspect`, consent checkbox + privacy notice
  link (consent text version stored). Idempotency-Key, per-IP rate limit (`internal/runtime/ratelimit`), honeypot field.
- Schema: `company_candidates.created_by` nullable (system actor) or a system user; new `source` (`careers_site`, shown
  as «Sitio de empleo»), `consent_at`, `consent_text_version`; CV attached to the company candidate without a
  participation + a pool CV route that doesn't require one. Audit event `TalentSubmittedFromCareersSite` (system actor).
- Response never reveals whether the person already existed (always the same «Recibimos tu CV» answer).
- Decided (user, L6): duplicates → create a new candidate and flag it «posible duplicado» (matched on normalized email
  or E.164 phone) for the team to resolve; notification → a «Nuevos desde el sitio» counter + origin filter in Base de
  talento AND an email to the owner. Retention (user, 2026-11-26): «Hasta que el equipo los borre» — no automatic deletion;
  the person can ask for deletion. Owner email: POSTPONED by the user until a full notification system is designed (see
  odd/tasks/notifications-system-idea.md); slice C ships with the in-app counter + origin filter only.

## Backend session adjustments to slice A (2026-11-25, accepted)

1. `secondary_target` must be the id of a block that exists in the document, else 400 `validation_error`; pointing to a
   hidden block is a publish issue; missing → null (= first block after the hero).
2. `team` items follow exactly the testimonials consent rule (same publish issue when consent is false).
3. `areas` overrides: key must be one of the professional-area catalog keys the backend validates vacancies with; duplicate
   keys rejected; each override has exactly one of icon / photo.
4. `style.overlay` and `style.image` must be null unless `background = "image"`; `image` required when it is.
5. Slice A needs a small migration (00066) relaxing the media kind CHECK for `logo` (guarded Down).
6. Every new key is optional on read with the proposed defaults; stored documents stay valid.
Backend branch `feat/careers-site-sections-v2-backend` (worktree ../peopleflow-vacantes-careersv2). Exact amendment and
error codes will come when committed; the frontend doesn't merge or emit new keys until slice A is in main.

## Backend confirmation of the frontend assumptions (2026-11-25)

All nine assumptions accepted (style defaults; collage `images` ≤3, ≥2 to publish; nullable hero labels with public
fallbacks; `video_url` string ≤500; `overrides[{key, icon|photo}]` ≤16; limits; publish rules). Details: a non-null
overlay only with background "image"; `secondary_target` = the hero itself → validation_error; a hidden target blocks
publish only when `secondary_visible`; missing style image is a publish issue (`style_image_missing`,
`blocks[i].style.image`), not a 400; codes `hero_video_missing`, `secondary_target_hidden`, `hero_collage_images_missing`;
team/logos reuse existing consent/title codes. GET never adds new keys to stored documents (old documents stay
byte-identical), so the backend merges first and the frontend switches when ready — no lockstep merge.

## Backend slice A committed (2026-11-25, amendment §2.3 in docs/contracts/company-careers-site-v1.md, migration 00066)

Extra rules to mirror in the frontend: media kinds — style.image `cover`, collage `images` and areas override photos
`gallery`, team photo `portrait`, logos image `logo`; `style: null` = absent; `images: null` → []; a present style is
filled to all 5 keys; team/logos absent strings → null, absent lists → []; logo upload JPEG → 415
`unsupported_media_type`, < 64 px → 422 `image_too_small`; `video_url` rejects explicit ports (even :443); a stored
`secondary_target` that no longer exists reads as null; save errors reuse existing codes; team/logos/areas/talent_cta
publish issues use `block_incomplete`. Backend merges to main after its full suite.

## Backend slice B shape (2026-11-26, branch feat/careers-hero-video-backend, migration 00067)

Upload: same multipart `/v2/me/company/site/media` with `kind=hero_video`; cap 20971520 bytes; duration ≤ 30000 ms; ftyp
brands isom/iso2/mp41/mp42/avc1; moov before or after mdat accepted (UI recommends faststart); streamed to a bounded temp
spool. Errors: 415 `unsupported_media_type`, 413 `payload_too_large`, 422 `video_too_long` {max_ms, duration_ms}, 422
`video_invalid`. Media item width/height from the first video track's tkhd (nullable), new `duration_ms` (null for images).
GET /media/{id}: Range → 206 + Content-Range + `Accept-Ranges: bytes`, 416 unsatisfiable, no Range → 200; same headers;
disk and S3 ranged GET. Hero `background_video: {media_id} | null` (kind hero_video via v.media), absent stays absent;
publishing `background_loop` needs background_video and cover, else `hero_video_missing`. Amendment §2.4 to follow.
