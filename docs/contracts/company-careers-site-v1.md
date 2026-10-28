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
  keycap; or a base with one or more tag characters U+E0020–U+E007E terminated by U+E007F. U+200D joins sequence
  elements. The entire string must match, be valid UTF-8 and be at most 32 bytes, with a pictographic, flag or
  keycap element. Whitespace, text, lone regional indicators, bare digits, adjacent unjoined emoji, dangling
  selectors/joiners/tags and arbitrary combining marks are rejected. No trimming or replacement is performed.
  Examples accepted: 😀, ❤️, 👍🏽, 👩‍💻, 👨‍👩‍👧‍👦, 🇲🇽, 🏳️‍🌈, 1️⃣ and the terminated Scotland tag flag.
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
  "company_logo_missing" | "company_name_missing", "field": "blocks[2]" | "slug" | null }]` — `no_content_block` means no
  visible block other than hero and jobs; `block_incomplete` means a visible block below its publish minimums.
- `unpublish`: 200; the public read returns 404 afterwards. Idempotent.
- Changing the slug and publishing moves the public URL; the previous published slug answers a redirect (§4.1).

### 3.4 `POST /v2/me/company/site/media`
`multipart/form-data`: `kind` (`cover` | `gallery` | `portrait` | `story`) and `file`. The frontend crops client-side
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
