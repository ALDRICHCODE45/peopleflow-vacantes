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
- Open: is ffmpeg acceptable on the backend image (would allow re-encode, poster frame, audio strip)?

## Slice C — public «Dejar mi CV» into the talent base (migration + anonymous endpoint; risk items 1/2)

- Route `POST /v2/company-sites/{slug}/talent` (multipart, anonymous): only when the site is published and has a visible
  `talent_cta` block. Fields: name, email and/or phone, residence, education level (required, as manual intake), areas of
  interest (from `PROFESSIONAL_AREA_OPTIONS`), CV PDF/DOCX ≤ 5 MiB via `cvs.Inspect`, consent checkbox + privacy notice
  link (consent text version stored). Idempotency-Key, per-IP rate limit (`internal/runtime/ratelimit`), honeypot field.
- Schema: `company_candidates.created_by` nullable (system actor) or a system user; new `source` (`careers_site`, shown
  as «Sitio de empleo»), `consent_at`, `consent_text_version`; CV attached to the company candidate without a
  participation + a pool CV route that doesn't require one. Audit event `TalentSubmittedFromCareersSite` (system actor).
- Response never reveals whether the person already existed (always the same «Recibimos tu CV» answer).
- Open product decisions: duplicate policy (merge into the existing candidate vs create and flag «posible duplicado»),
  notification to the team (none exists today: badge in Base de talento?), retention period.
