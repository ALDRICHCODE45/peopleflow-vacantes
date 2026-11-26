# Company careers site — API contract v1 (proposal)

Status: **agreed** with the backend session (2026-10-27, backend branch `feat/company-careers-site`); originally proposed by the frontend session (2026-10-26) for `odd/tasks/company-careers-builder.md`, to be agreed with
the backend session before implementation. Product decisions: S1–S11 of that document. UI design comes later from v0;
this contract does not depend on it.

## 1. Concepts

- One **site** per company. It has an autosaved **draft** (versioned, ETag) and at most one **published** snapshot.
  Publishing copies the exact draft version into the published snapshot; editing never touches what visitors see.
- Company identity (name, logo, description, website, socials) is **not** part of the site: the public read joins it
  from the company profile (S9). The site stores only `slug`, `theme`, `seo` and `blocks`.
- Roles (S8): any company member (`requireRecruiter` + membership) reads and saves the draft; only the **owner**
  publishes and unpublishes.

## 2. Site document (draft body)

```json
{
  "slug": "nexo-labs",
  "theme": { "brand_color": "#0F766E", "accent_color": null, "background_color": null, "font_pair": "classic" },
  "seo": { "title": "Trabaja en Nexo Labs", "description": "…" },
  "blocks": [
    { "id": "0f6d…uuid", "type": "hero", "variant": "photo", "hidden": false, "content": { … } }
  ]
}
```

- `slug`: 3–60 chars, `^[a-z0-9]+(?:-[a-z0-9]+)*$`, unique across companies, not in the reserved list (`admin`, `api`,
  `empresa`, `empresas`, `vacantes`, `candidato`, `login`, `nuevo`, `nueva`, `peopleflow`, `soporte`, `ayuda`). `null`
  until chosen. Uniqueness is checked (and reserved) on draft save.
- `theme.brand_color`: required principal color, `#RRGGBB` (uppercase or lowercase accepted, stored uppercase).
- `theme.accent_color`, `theme.background_color`: `string|null`, exactly `#RRGGBB` when non-null, stored uppercase;
  missing keys normalize to `null`. Both default to `null`. Invalid types/formats → `invalid` at `theme.<key>`;
  unknown theme keys → `unknown_key`. `brand_color` validation and defaults are unchanged. Contrast, palettes,
  presets and derived dark tokens are rendering concerns (frontend); the backend only validates/stores colors.
- `theme.font_pair`: `classic` | `editorial` | `modern`.
- `seo.title` ≤ 60, `seo.description` ≤ 160; both nullable.
- `blocks`: 2–30 items, ordered. `id` is a client-generated UUID, unique within the document. Exactly one `hero` and one
  `jobs` block, never `hidden`. Other types may repeat (e.g. two `gallery` blocks) — up to 30 blocks total.
- Strings are trimmed; blank optional strings become `null`; limits count Unicode code points, except `emoji`
  (untrimmed, byte-limited) and the new palette colors (exact hex format). Unknown keys → 400 `validation_error`.

### 2.1 Block types, variants and content (limits are hard)

| type | variants | content |
| --- | --- | --- |
| `hero` | `photo`, `split`, `centered` | `title` ≤ 80 (required to publish), `subtitle` ≤ 200, `cover` media ref (kind `cover`) |
| `story` | `text`, `text_image` | `title` ≤ 80, `body` rich text (same canonical format and validator as the vacancy description, ≤ 5,000 code points of text), `image` media ref |
| `values` | `grid`, `list` | `mission` ≤ 300, `items` 1–8 × {`icon`, `emoji` (below), `title` ≤ 60, `description` ≤ 240} |
| `benefits` | `grid`, `compact` | `items` 1–24 × {`icon`, `emoji`, `title` ≤ 60, `description` ≤ 160} |
| `stats` | `row`, `cards` | `items` 1–6 × {`value` ≤ 12, `label` ≤ 60} |
| `process` | `steps`, `timeline` | `items` 2–8 × {`title` ≤ 60, `description` ≤ 200, `duration` ≤ 30 nullable} |
| `gallery` | `grid`, `mosaic`, `carousel` | `items` 2–12 × {`image` media ref (kind `gallery`), `alt` ≤ 160 required, `caption` ≤ 120} |
| `testimonials` | `cards`, `quote` | `items` 1–6 × {`quote` ≤ 400, `name` ≤ 80, `role` ≤ 80, `photo` media ref (kind `portrait`) nullable, `consent` boolean (`true` required only to publish)} |
| `video` | `wide`, `split` | `video` `{provider: "youtube" | "vimeo", video_id}` or `null` (the client parses the pasted YouTube/Vimeo URL; YouTube id `^[A-Za-z0-9_-]{11}$`, Vimeo id `^\d{1,12}$`), `title` ≤ 80, `description` ≤ 200 |
| `offices` | `list`, `cards` | `items` 1–20 × {`name` ≤ 80, `location` (same `LocationInput` as the company profile: country; MX state + municipality), `address` ≤ 200, `map_url` https ≤ 500} |
| `jobs` | `list`, `cards`, `by_area` | `title` ≤ 80, `intro` ≤ 200 (the vacancies themselves come from the public catalog, never stored here) |
| `faq` | `accordion`, `two_columns` | `items` 1–20 × {`question` ≤ 160, `answer` ≤ 1,000} |
| `closing` | `banner`, `simple` | `title` ≤ 80, `text` ≤ 240 |

- Draft saves accept **incomplete** content (empty lists, null titles, items with blank fields) so autosave never fails
  on work in progress; maximums, formats, URL/id rules and unknown keys are enforced on every save. Items in `values`
  and `benefits` additionally require exactly one of `icon` or `emoji` on PUT (§2.2).
- **Publish requirements** (only for visible blocks; anything else is `block_incomplete` with `field: "blocks[i]"`):

  | type | required to publish |
  | --- | --- |
  | `hero` | `title` (its own issue code `hero_title_missing`) |
  | `story` | `body` with non-blank text |
  | `values` | 1–8 items, each `title` |
  | `benefits` | 1–24 items, each `title` |
  | `stats` | 1–6 items, each `value` and `label` |
  | `process` | 2–8 items, each `title` |
  | `gallery` | 2–12 items, each `image` and `alt` |
  | `testimonials` | 1–6 items, each `quote`, `name` and `consent: true` |
  | `video` | `video` non-null |
  | `offices` | 1–20 items, each `name` and `location` (country) |
  | `jobs` | nothing (blank `title` renders «Vacantes abiertas») |
  | `faq` | 1–20 items, each `question` and `answer` |
  | `closing` | `title` |

  Optional everywhere: block titles not listed, descriptions, captions, `role`, photos, `duration`, `address`, `map_url`,
  `mission`, `intro`, `text`.
- `icon` enum (111, ordered; original 24 first): `heart`, `users`, `rocket`, `target`, `lightbulb`, `shield`, `leaf`, `globe`, `graduation-cap`,
  `briefcase`, `laptop`, `clock`, `calendar`, `coffee`, `dumbbell`, `stethoscope`, `piggy-bank`, `gift`, `plane`,
  `home`, `sparkles`, `handshake`, `trophy`, `smile`,
  `star`, `award`, `medal`, `crown`, `flag`, `compass`, `map-pin`, `mountain`, `sun`, `moon`, `zap`, `flame`, `gem`,
  `puzzle`, `brain`, `book-open`, `pencil`, `palette`, `music`, `camera`, `code`, `terminal`, `cpu`, `database`,
  `cloud`, `wifi`, `smartphone`, `monitor`, `headphones`, `message-circle`, `mail`, `phone`, `megaphone`, `bell`,
  `trending-up`, `chart-bar`, `chart-pie`, `dollar-sign`, `wallet`, `credit-card`, `banknote`, `shopping-bag`, `car`,
  `bike`, `bus`, `train-front`, `baby`, `dog`, `cat`, `utensils`, `pizza`, `apple`, `salad`, `heart-handshake`,
  `hand-heart`, `hand-helping`, `thumbs-up`, `party-popper`, `cake`, `gamepad-2`, `tree-pine`, `recycle`, `sprout`,
  `flower-2`, `umbrella`, `shield-check`, `lock`, `key`, `scale`, `building-2`, `factory`, `store`, `wrench`, `hammer`,
  `hard-hat`, `truck`, `package`, `infinity`, `accessibility`, `languages`, `calendar-check`, `timer`, `bot`,
  `microscope`, `paintbrush`, `film`, `mic`.
- Media ref: `{ "media_id": "uuid" }` pointing to an upload of this company (§3.4); `null` when absent.

### 2.2 Icon or emoji items and legacy reads

- `values.items[]` and `benefits.items[]` always serialize both `icon: string|null` and `emoji: string|null`.
  PUT requires exactly one non-null value. For `p = blocks[i].content.items[j]`:

  | condition | field | code |
  | --- | --- | --- |
  | both null/missing | `p.icon` | `required` |
  | both non-null | `p.emoji` | `not_allowed` |
  | unknown icon | `p.icon` | `invalid` |
  | malformed, empty, non-string or non-emoji emoji | `p.emoji` | `invalid` |
  | emoji over 32 UTF-8 bytes | `p.emoji` | `too_long` |

  These are 400 `validation_error` responses (§3.2); no write occurs.
- Emoji is exactly one complete UTS #51-style sequence over the generated Unicode 15.0.0
  `Extended_Pictographic` table (no runtime dependency): a pictographic base with optional U+FE0F, optional skin-tone
  modifier U+1F3FB–U+1F3FF; exactly two regional indicators for a flag; `[0-9#*]` + optional FE0F + U+20E3 for a
  keycap; or a base with one or more tag characters U+E0020–U+E007E terminated by U+E007F. U+200D joins
  pictographic elements only (base, optional FE0F, optional modifier); flags, keycaps and tag sequences stand alone,
  so `🇲🇽‍🇺🇸`, `😀‍🇲🇽`, `1️⃣‍😀` and a tag sequence joined to anything are `invalid`. The entire string must
  match, be valid UTF-8 and be at most 32 bytes, with a pictographic, flag or keycap element. Whitespace, text, lone regional indicators, bare digits, adjacent unjoined emoji, dangling
  selectors/joiners/tags and arbitrary combining marks are rejected. No trimming or replacement is performed.
  Examples accepted: 😀, ❤️, 👍🏽, 👩‍💻, 👨‍👩‍👧‍👦, 🇲🇽, 🏳️‍🌈, 🏴‍☠️, 1️⃣ and the terminated Scotland tag flag.
  `♡` (U+2661) is accepted because it is in `Extended_Pictographic`; this is a property-based grammar, not an RGI
  emoji allowlist. Byte limits still apply to long sequences.
- Stored drafts and published snapshots missing `emoji`, `accent_color` or `background_color` read with those keys
  set to `null`. GET draft, publish responses and GET public always return canonical keys; no migration is needed.
  An explicit stored-document mode allows a legacy item with neither icon nor emoji, avoiding read/publish failures.
  Only that missing-decoration rule is relaxed: both-set values, invalid emoji/icons, invalid palettes and unknown
  keys remain invalid. Strict PUT does not grandfather missing decorations.
- Publish requirements in §2.1 are unchanged: neither icon nor emoji is required to publish a legacy stored item;
  `values`/`benefits` still require item titles and minimum list sizes. Publishing still copies the stored draft
  version exactly; normalization is on read, not a data migration.

### 2.3 Sections v2 — amendment 2026-11-25 (additive; backend branch `feat/careers-site-sections-v2-backend`)

Slice A of the careers site sections v2 (task `odd/tasks/careers-site-sections-v2-backend.md` S1–S3 and L4). New
variants, four new block types, a per-block `style`, hero button and collage keys, a testimonial video URL and the media
kind `logo`. No document migration; one media migration (00066). Everything in §2–§2.2 stays valid.

**Wire rule (deployment order).** Keys added to existing envelopes and types — `style`, the hero keys `images`,
`primary_label`, `secondary_visible`, `secondary_label`, `secondary_target`, and `testimonials.items[].video_url` — are
**never inserted** into a document that lacks them, neither on PUT canonicalization nor on GET draft, publish responses
or GET public. Absent means “use the default below”; validation and publish logic apply that default. A stored v1
document therefore re-reads byte-identical to its §2.2 canonical form, and a PUT echoing it is a no-op (§6.6). The keys
appear only once a client sends them. New block types (`team`, `logos`, `areas`, `talent_cta`) are normalized like every
other block (missing strings → `null`, missing lists → `[]`).

**New variants on existing types**

| type | added variants | notes |
| --- | --- | --- |
| `hero` | `background_loop`, `photo_jobs`, `collage` | `background_loop` needs `background_video` and `cover` to publish (§2.4, slice B); `collage` needs ≥ 2 `images` to publish |
| `values`, `benefits` | `bento`, `big_icons` | |
| `stats` (Cifras) | `brand_band` | count-up is presentation only |
| `testimonials` | `carousel` | items may carry `video_url` (below), on any variant |
| `gallery` | `photo_strip` | reduced motion is presentation only |

**Block envelope `style`** (optional, next to `id`, `type`, `variant`, `hidden`, `content`; any block type):

```json
{ "background": "default", "spacing": "airy", "align": "start", "overlay": null, "image": null }
```

- That object is the default (absent `style` means exactly this). `style: null` is accepted and dropped (= absent). A
  present `style` fills each missing key with its default and is returned with all five keys.
- `background`: `default` | `tint` | `brand` | `image`; `spacing`: `compact` | `airy`; `align`: `center` | `start`;
  `overlay`: `soft` | `medium` | `strong` | `null`; `image`: media ref (kind `cover`, ownership checked like every
  media ref) or `null`. Curated values only; enum values are trimmed and compared exactly.
- `overlay` and `image` must be `null` unless `background = "image"` (`not_allowed`). With `background = "image"`,
  `overlay` may be `null`, and a missing `image` is **not** a save error: it is the publish issue `style_image_missing`.

**Hero content additions** (all optional, absent stays absent):

```json
{ "title": "Únete", "subtitle": null, "cover": { "media_id": "uuid" },
  "images": [ { "media_id": "uuid" }, { "media_id": "uuid" } ],
  "primary_label": "Ver puestos", "secondary_visible": true, "secondary_label": "Conócenos",
  "secondary_target": "uuid-of-another-block" }
```

| key | rule | absent / blank means |
| --- | --- | --- |
| `images` | 0–3 non-null media refs (kind `gallery`); `null` → `[]` | `[]` |
| `primary_label` | string ≤ 24 or `null`; blank → `null` | presentation falls back to «Ver vacantes» |
| `secondary_label` | string ≤ 24 or `null`; blank → `null` | presentation falls back to «Conoce la empresa» |
| `secondary_visible` | boolean (`null` is `invalid`) | `true` |
| `secondary_target` | `null` or the id (UUID, any case, stored lower-case) of **another** block of the document | `null` = first block after the hero |

`secondary_target` naming the hero itself or an id not in the document → `invalid`. Stored documents whose target no
longer exists (including the public projection, which drops hidden blocks) read the target as `null`.

**Testimonial items**: `video_url` string ≤ 500 or `null` (blank → `null`). Accepted exactly as the editor parses a
video block URL: `http(s)` without credentials or port; `youtube.com`/`www.youtube.com` `/watch?v=ID`, `/embed/ID`,
`/shorts/ID`; `youtu.be/ID`; `vimeo.com`/`www.vimeo.com` `/ID`; `player.vimeo.com/video/ID` (host case-insensitive);
YouTube id `^[A-Za-z0-9_-]{11}$`, Vimeo id `^\d{1,12}$`. Anything else → `invalid`; over 500 → `too_long`.

**New block types**

| type | variants | content |
| --- | --- | --- |
| `team` («Equipo / Líderes») | `grid`, `portraits` | `title` ≤ 80, `intro` ≤ 200, `items` 0–12 × {`name` ≤ 80, `role` ≤ 80, `photo` media ref (kind `portrait`) nullable, `consent` boolean} |
| `logos` («Logos / Reconocimientos») | `strip`, `grid` | `title` ≤ 80, `items` 0–12 × {`name` ≤ 80, `image` media ref (kind `logo`) nullable, `caption` ≤ 80} |
| `areas` («Áreas de trabajo») | `icon_cards`, `photo_cards` | `title` ≤ 80, `intro` ≤ 200, `overrides` 0–16 × {`key`, `icon`, `photo` media ref (kind `gallery`)} |
| `talent_cta` («Llamado a talento») | `banner`, `split` | `title` ≤ 80, `text` ≤ 240, `button_label` ≤ 24 (blank → `null`; presentation falls back to «Dejar mi CV») |

```json
{ "id": "uuid", "type": "team", "variant": "portraits", "hidden": false,
  "content": { "title": "Líderes", "intro": null,
    "items": [ { "name": "Luis", "role": "CEO", "photo": { "media_id": "uuid" }, "consent": true } ] } }
{ "id": "uuid", "type": "logos", "variant": "strip", "hidden": false,
  "content": { "title": "Reconocimientos",
    "items": [ { "name": "Great Place to Work", "image": { "media_id": "uuid" }, "caption": "2026" } ] } }
{ "id": "uuid", "type": "areas", "variant": "photo_cards", "hidden": false,
  "content": { "title": "Áreas", "intro": null,
    "overrides": [ { "key": "logistics_transport", "icon": null, "photo": { "media_id": "uuid" } },
                   { "key": "legal", "icon": "scale", "photo": null } ] } }
{ "id": "uuid", "type": "talent_cta", "variant": "banner", "hidden": false,
  "content": { "title": "¿No hay vacante para ti?", "text": "Déjanos tu CV", "button_label": "Dejar mi CV" } }
```

- `team.items[].consent`: same rule as testimonials (non-boolean → `invalid`; `true` required only to publish).
- `areas`: the areas themselves come from the published vacancies (`professional_area`); `overrides` only restyle one.
  `key` must be one of the 16 vacancy `professional_area` literals (`technology_systems`, `engineering`, `product`,
  `design_creative`, `sales_business_development`, `marketing_communications`, `administration_finance`,
  `human_resources`, `operations_production`, `logistics_transport`, `customer_service_support`, `healthcare`,
  `education_training`, `legal`, `construction_maintenance`, `tourism_hospitality_gastronomy`); `icon` is the §2.1
  icon enum; exactly one of `icon` / `photo` is non-null. Unlike `values`/`benefits` decorations this is enforced on
  every PUT (no legacy data exists).
- `talent_cta` is accepted and publishable; its form ships with slice C (until then the editor does not offer it).

**Validation errors** (400 `validation_error`, nothing written; `p = blocks[i]`):

| condition | field | code |
| --- | --- | --- |
| unknown variant / type | `p.variant` / `p.type` | `invalid` |
| `style` not an object; `background`/`spacing`/`align`/`overlay` outside its set (incl. `null` for the first three) | `p.style` / `p.style.<key>` | `invalid` |
| unknown key in `style` | `p.style.<key>` | `unknown_key` |
| `overlay` or `image` non-null while `background ≠ "image"` | `p.style.overlay` / `p.style.image` | `not_allowed` |
| `style.image` malformed / not this company's `cover` media | `p.style.image.media_id` / `p.style.image` | `invalid` |
| hero label over 24 / not a string | `p.content.primary_label` (or `secondary_label`) | `too_long` / `invalid` |
| `secondary_visible` not a boolean | `p.content.secondary_visible` | `invalid` |
| `secondary_target` malformed, unknown or the hero itself | `p.content.secondary_target` | `invalid` |
| `images` not a list / over 3 / null item / not this company's `gallery` media | `p.content.images` / `p.content.images` / `p.content.images[k]` / `p.content.images[k]` | `invalid` / `too_long` / `required` / `invalid` |
| `video_url` not a supported URL / over 500 | `p.content.items[j].video_url` | `invalid` / `too_long` |
| team/logos list over 12, overrides over 16 | `p.content.items` / `p.content.overrides` | `too_long` |
| team photo not `portrait`, logo image not `logo`, override photo not `gallery` (or foreign) | the ref's field | `invalid` |
| override `key` missing / outside the catalog / repeated | `p.content.overrides[k].key` | `required` / `invalid` / `duplicate` |
| override with both `icon` and `photo` / neither | `p.content.overrides[k].photo` / `p.content.overrides[k].icon` | `not_allowed` / `required` |
| unknown icon in an override | `p.content.overrides[k].icon` | `invalid` |
| string limits above | the string's field | `too_long` |

**Publish requirements and issues** (422 `publish_blocked`, visible blocks only):

| type / condition | issue code | field |
| --- | --- | --- |
| `team` | `block_incomplete` unless 1–12 items, each `name` and `consent: true` (photo optional) | `blocks[i]` |
| `logos` | `block_incomplete` unless 1–12 items, each `name` and `image` | `blocks[i]` |
| `areas` | `block_incomplete` unless `title` (overrides never block) | `blocks[i]` |
| `talent_cta` | `block_incomplete` unless `title` | `blocks[i]` |
| hero `background_loop` without `background_video` or `cover` (§2.4; before slice B: always) | `hero_video_missing` | `blocks[i]` |
| hero `collage` with fewer than 2 `images` (absent = `[]`) | `hero_collage_images_missing` | `blocks[i]` |
| `secondary_target` names a hidden block while `secondary_visible` is `true` (absent = `true`) | `secondary_target_hidden` | `blocks[i].content.secondary_target` |
| any visible block with `style.background = "image"` and `style.image` null/missing | `style_image_missing` | `blocks[i].style.image` |

Issue order: per block in document order — hero `hero_title_missing`, `hero_video_missing`,
`hero_collage_images_missing`, `secondary_target_hidden`; other blocks `block_incomplete`; then `style_image_missing` —
followed by the existing document-level issues. The §2.1 table is otherwise unchanged.

**Media kind `logo`** (§3.4): `POST /v2/me/company/site/media` accepts `kind=logo`: PNG or WebP only (alpha kept;
JPEG → 415 `unsupported_media_type`), 64–6,000 px per side (below → 422 `image_too_small`), ≤ 5 MB, same magic-byte
detection and metadata stripping. Other kinds are unchanged (JPEG/PNG/WebP, 200–6,000 px). Migration 00066 relaxes the
`company_site_media` CHECKs accordingly; its Down refuses while any `logo` media exists.

### 2.4 Hero video — amendment 2026-11-26 (slice B; backend branch `feat/careers-hero-video-backend`)

Slice B of the careers site sections v2 (task `odd/tasks/careers-hero-video-backend.md` S1–S2): an uploaded MP4 plays
behind the hero `background_loop` variant. One media migration (00067); no document migration. Everything in §2–§2.3
stays valid; the §2.3 wire rule applies to the new key.

**Hero content `background_video`** (optional; absent stays absent — never inserted on PUT, GET draft, publish or GET
public, so documents stored before slice B re-read byte-identical):

```json
{ "title": "Únete", "cover": { "media_id": "uuid-of-a-cover" }, "background_video": { "media_id": "uuid-of-a-hero_video" } }
```

| key | rule | absent means |
| --- | --- | --- |
| `background_video` | `null` (kept as `null`) or a media ref of this company's media of kind `hero_video` (ownership and kind checked on save like every ref) | `null` |

Only the hero accepts it (elsewhere `unknown_key`). Validation errors (400 `validation_error`, nothing written):
not an object → `invalid` at `p.content.background_video`; malformed id → `invalid` at
`p.content.background_video.media_id`; extra key → `unknown_key`; another company's media or a media of another kind →
`invalid` at `p.content.background_video`.

**Publish rule** (replaces the §2.3 «always blocked» row): a visible hero with variant `background_loop` needs a
non-null `background_video` **and** a non-null `cover` (the poster shown before the video plays and under reduced
motion); otherwise the issue `hero_video_missing` with field `blocks[i]` (same position in the issue order). Other
variants ignore `background_video`.

**Media kind `hero_video`** (`POST /v2/me/company/site/media`, same multipart endpoint, `kind=hero_video` + `file`):

- MP4 only, validated structurally (no decoding, no ffmpeg; codec and audio are not checked — presentation always plays
  muted, looped, `playsinline`, paused under reduced motion). The file part's name must end in `.mp4` (any case) and its
  declared `Content-Type`, when present, must be `video/mp4` or `application/octet-stream`.
- The first box must be `ftyp` with major or a compatible brand in `isom`, `iso2`, `mp41`, `mp42`, `avc1`; the
  top-level boxes must tile the file exactly; a `moov` (before or after `mdat` — after is accepted, the first frame is
  just slower) must contain an `mvhd` with a non-zero timescale and a known, non-zero duration (32- or 64-bit).
  `duration_ms` = ceil(duration × 1000 / timescale). Width/height come from the `tkhd` of the first track whose
  `hdlr` is `vide` (integer part of the 16.16 values) when within 1–16,384; otherwise both are `null`.
- ≤ 20 MiB (20,971,520 bytes; request cap = that + 64 KiB of multipart overhead), ≤ 30,000 ms. The body is streamed
  to a bounded temporary file (never held in memory) and removed on every path; then stored through the media storage.
- 201 `{ "id", "kind": "hero_video", "url", "width": 1920 | null, "height": 1080 | null, "duration_ms": 12500,
  "content_type": "video/mp4" }`. `duration_ms` appears **only** on hero videos (image JSON is unchanged); the same
  object shape is used in the `media` lists of §3.1 and §4.1.
- Errors (nothing stored):

  | condition | status | body |
  | --- | --- | --- |
  | name not `.mp4`, declared type not MP4, first box not `ftyp`, brand not accepted | 415 | `{"error":"unsupported media type","code":"unsupported_media_type"}` |
  | file over 20 MiB / request over the cap | 413 | `{"error":"payload too large","code":"payload_too_large"}` |
  | duration over 30 s | 422 | `{"error":"video too long","code":"video_too_long","data":{"max_ms":30000,"duration_ms":31000}}` |
  | no parsable `moov`/`mvhd`, zero timescale or duration, malformed/truncated boxes, size fields that lie | 422 | `{"error":"video invalid","code":"video_invalid"}` |
  | 300 media per company reached | 422 | `{"error":"media limit reached","code":"media_limit_reached"}` |

  `data.duration_ms` is the measured duration (saturated at 2^53 − 1 for absurd files).

**Public media route** `GET /v2/company-sites/media/{id}` (§6.1), every kind: answers a single `Range: bytes=…`
(first-last, open-ended `N-`, suffix `-N`) with 206, `Content-Range: bytes a-b/size` and the slice; no `Range` → 200 with
the whole file; both carry `Accept-Ranges: bytes`, `Content-Length`, the DB content type, `nosniff`, CSP
`default-src 'none'; sandbox` and `public, max-age=31536000, immutable`. An unsatisfiable range → 416 with
`Content-Range: bytes */size`, `Cache-Control: no-store` and an empty body; a request with several ranges is answered
200 with the whole file, and so is a malformed spec, another unit or `bytes=-0` (the header is ignored, RFC 9110
§14.2). 404 `not_found` / 500 `internal_error` keep `no-store`. Disk serves the file; S3 issues one
ranged `GetObject` per response and streams it (videos never go through the 5 MiB buffered image read).

## 3. Private endpoints (`requireAuth` + `requireRecruiter`, member of the company; `Cache-Control: no-store`)

### 3.1 `GET /v2/me/company/site`
200 — created lazily with defaults on first read (hero + jobs blocks, `classic`, brand color `#7835DB`, slug `null`):
```json
{
  "draft": { …site document… },
  "draft_version": 7,
  "published": { "version": 5, "slug": "nexo-labs", "published_at": "2026-10-26T…Z" } ,
  "has_unpublished_changes": true,
  "media": [ { "id": "uuid", "kind": "cover", "url": "https://…", "width": 1920, "height": 1080 } ],
  "updated_at": "…"
}
```
`ETag: "7"`. `published` is `null` when never published or unpublished. `media` lists every media referenced by the
draft (so the editor can render it). 403 `forbidden` when the user is not a member (`requireRecruiter`), 403
`company_inactive` when the company is deleted.

### 3.2 `PUT /v2/me/company/site/draft`
Body: full site document. `If-Match: "<draft_version>"` required (428 `precondition_required` without it).
- 200 same shape as 3.1 with the new version/ETag.
- 412 `version_conflict` with the current body (same shape as 3.1) — the client never merges.
- 400 `validation_error`, `fields: [{ "field": "blocks[3].content.items[0].title", "code": "too_long" | "required" |
  "invalid" | "unknown_key" | "duplicate" | "not_allowed" }]` — nothing is written.
- 409 `slug_taken` / 422 `slug_reserved` with `field: "slug"`.
- Unreferenced media are kept (garbage collection is a later concern).

### 3.3 `POST /v2/me/company/site/publish` and `POST /v2/me/company/site/unpublish` (owner only)
- `publish`: `If-Match: "<draft_version>"` — publishes exactly that version. 200 same shape as 3.1. 412 if the draft
  changed. 403 `forbidden` for non-owners (`requireOwner`). 422 `publish_blocked` with
  `issues: [{ "code": "slug_missing" | "hero_title_missing" | "no_content_block" | "block_incomplete" |
  "company_logo_missing" | "company_name_missing" | the §2.3 codes, "field": "blocks[2]" | "slug" | null }]` — `no_content_block` means no
  visible block other than hero and jobs; `block_incomplete` means a visible block below its publish minimums.
- `unpublish`: 200; the public read returns 404 afterwards. Idempotent.
- Changing the slug and publishing moves the public URL; the previous published slug answers a redirect (§4.1).

### 3.4 `POST /v2/me/company/site/media`
`multipart/form-data`: `kind` (`cover` | `gallery` | `portrait` | `story` | `logo` — §2.3 | `hero_video` — §2.4) and `file`. The frontend crops client-side
(cover 16:9, gallery 4:3, portrait 1:1, story free) and uploads the result.
- Accept JPEG, PNG, WebP by **magic bytes**; ≤ 5 MB; 200–6,000 px per side; strip EXIF; store via the existing storage
  port (S3 in production). 201 `{ id, kind, url, width, height, content_type }`.
- 413 `payload_too_large`, 415 `unsupported_media_type`, 422 `image_too_small` / `image_too_large`.
- `url` must be loadable by anonymous visitors once referenced by a published site (public bucket path / CloudFront
  or a public `GET /v2/company-sites/media/{id}` with long immutable caching — backend's choice).

### 3.5 `GET /v2/me/company/site/slug-availability?slug=…`
200 `{ "slug": "nexo-labs", "available": false, "reason": "taken" | "reserved" | "invalid" | null }`. The company's own
current slug is available to itself.

## 4. Public endpoints (anonymous, outside auth groups)

### 4.1 `GET /v2/company-sites/{slug}`
- 200 `{ "company": { "id", "name", "logo_url", "description", "website", "linkedin_url", "instagram_url",
  "facebook_url", "twitter_url", "location" }, "site": { …published document without slug… }, "slug",
  "published_at", "media": [ … ] }`. Short public caching is fine (e.g. `max-age=60`); the frontend renders it
  dynamically.
- A previous slug of a still-published site: 200 `{ "code": "moved", "slug": "<current>" }` — the frontend issues a
  308 redirect. (Or a 301 from the API; agree one.)
- 404 `site_not_found` for unknown, never-published or unpublished sites (no difference exposed).

### 4.2 Public catalog filtered by company (S11)
`GET /v2/jobs?company_id=<uuid>` added to the existing list filters (`q`, `work_mode`, `state`, cursor…), same item
shape and canonicalization as today. Only that company's published vacancies. Invalid UUID → 400 `invalid_filter`.

## 5. Removal

Frontend removes the prototype local editor and `PROTOTYPE_COMPANY_PROFILES`/Acme public page (S10). `/empresas/{x}`
renders only §4.1. `GET /companies/{id}` stays as is for other consumers.

## 6. Agreed with the backend session (2026-10-27)

1. **Media URL**: `url` = `/v2/company-sites/media/{id}` (API-relative), public and anonymous, `Cache-Control: public,
   max-age=31536000, immutable`, `X-Content-Type-Options: nosniff`, detected Content-Type. Capability URL: anyone with
   the random UUID can load it, even if only referenced by a draft (needed because `<img>` sends no Bearer). No
   listing. S3/CloudFront later is an adapter change only. The frontend serves it from its own origin (route/rewrite to
   the API) because the API origin is server-only (design D3). **Flagged for user review.**
2. **Old slugs**: `GET /v2/company-sites/{old}` answers 200 with the same §4.1 shape and `slug` = current; the frontend
   compares and issues a 308. History redirects until another company claims the slug (allowed; it drops the redirect).
   A company may reuse its own old slugs.
3. Published snapshot stored as a **copy** (jsonb document + version + published_at).
4. `story.body`: backend reuses `draftrich.ValidateDocument` (same `{schema_version: 1, document}` envelope as the
   vacancy description) plus ≤ 5,000 plain-text code points.
5. 412 uses the uniform error shape `{ "error", "code": "version_conflict", "current": { …3.1 shape… } }` plus the
   current `ETag`.
6. PUT with a canonical document identical to the current one is a **no-op**: 200, same version and ETag.
7. Public read drops `hidden` blocks and lists only media referenced by visible blocks; publish stores the full
   document and filtering happens on read.
8. PUT body ≤ 1 MiB (413). Media ≤ 300 per company → 422 `media_limit_reached`.
9. publish/unpublish write an audit event in the same transaction; `unpublish` is owner-only, no If-Match,
   idempotent; `publish` without If-Match → 428.
10. ETag `"<draft_version>"`. Gates keep the shared catalog: non-member 403 `forbidden`, deleted company 403
    `company_inactive`, non-owner on publish/unpublish 403 `forbidden`, validation 400 `validation_error` (no
    `company_not_found`, no `forbidden_role`, no 422 for validation).
11. EXIF/XMP/text metadata stripped by removing segments/chunks, without re-encoding.
12. `company.location` in §4.1 has the same shape as `GET /companies/{id}`.
