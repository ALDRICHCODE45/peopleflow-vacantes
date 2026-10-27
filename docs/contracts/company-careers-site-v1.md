# Company careers site — API contract v1 (proposal)

Status: proposal from the frontend session (2026-10-26) for `odd/tasks/company-careers-builder.md`, to be agreed with
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
  "theme": { "brand_color": "#0F766E", "font_pair": "classic" },
  "seo": { "title": "Trabaja en Nexo Labs", "description": "…" },
  "blocks": [
    { "id": "0f6d…uuid", "type": "hero", "variant": "photo", "hidden": false, "content": { … } }
  ]
}
```

- `slug`: 3–60 chars, `^[a-z0-9]+(?:-[a-z0-9]+)*$`, unique across companies, not in the reserved list (`admin`, `api`,
  `empresa`, `empresas`, `vacantes`, `candidato`, `login`, `nuevo`, `nueva`, `peopleflow`, `soporte`, `ayuda`). `null`
  until chosen. Uniqueness is checked (and reserved) on draft save.
- `theme.brand_color`: `#RRGGBB` (uppercase or lowercase accepted, stored uppercase). Contrast adjustment is a
  rendering concern (frontend); the backend stores the chosen color as is.
- `theme.font_pair`: `classic` | `editorial` | `modern`.
- `seo.title` ≤ 60, `seo.description` ≤ 160; both nullable.
- `blocks`: 2–30 items, ordered. `id` is a client-generated UUID, unique within the document. Exactly one `hero` and one
  `jobs` block, never `hidden`. Other types may repeat (e.g. two `gallery` blocks) — up to 30 blocks total.
- Strings are trimmed; blank optional strings become `null`; limits count Unicode code points. Unknown keys → 422.

### 2.1 Block types, variants and content (limits are hard)

| type | variants | content |
| --- | --- | --- |
| `hero` | `photo`, `split`, `centered` | `title` ≤ 80 (required to publish), `subtitle` ≤ 200, `cover` media ref (kind `cover`) |
| `story` | `text`, `text_image` | `title` ≤ 80, `body` rich text (same canonical format and validator as the vacancy description, ≤ 5,000 code points of text), `image` media ref |
| `values` | `grid`, `list` | `mission` ≤ 300, `items` 1–8 × {`icon` (enum below), `title` ≤ 60, `description` ≤ 240} |
| `benefits` | `grid`, `compact` | `items` 1–24 × {`icon`, `title` ≤ 60, `description` ≤ 160} |
| `stats` | `row`, `cards` | `items` 1–6 × {`value` ≤ 12, `label` ≤ 60} |
| `process` | `steps`, `timeline` | `items` 2–8 × {`title` ≤ 60, `description` ≤ 200, `duration` ≤ 30 nullable} |
| `gallery` | `grid`, `mosaic`, `carousel` | `items` 2–12 × {`image` media ref (kind `gallery`), `alt` ≤ 160 required, `caption` ≤ 120} |
| `testimonials` | `cards`, `quote` | `items` 1–6 × {`quote` ≤ 400, `name` ≤ 80, `role` ≤ 80, `photo` media ref (kind `portrait`) nullable, `consent` must be `true`} |
| `video` | `wide`, `split` | `url` YouTube/Vimeo only (normalized to `{provider, video_id}`), `title` ≤ 80, `description` ≤ 200 |
| `offices` | `list`, `cards` | `items` 1–20 × {`name` ≤ 80, `location` (same `LocationInput` as the company profile: country; MX state + municipality), `address` ≤ 200, `map_url` https ≤ 500} |
| `jobs` | `list`, `cards`, `by_area` | `title` ≤ 80, `intro` ≤ 200 (the vacancies themselves come from the public catalog, never stored here) |
| `faq` | `accordion`, `two_columns` | `items` 1–20 × {`question` ≤ 160, `answer` ≤ 1,000} |
| `closing` | `banner`, `simple` | `title` ≤ 80, `text` ≤ 240 |

- Draft saves accept **incomplete** content (empty lists, null titles) so autosave never fails on work in progress;
  the minimums (`1–8`, `2–12`, …) are **publish** requirements. Maximums, formats, `consent: true` when a testimonial
  exists, URL rules and unknown keys are enforced on every save.
- `icon` enum (24): `heart`, `users`, `rocket`, `target`, `lightbulb`, `shield`, `leaf`, `globe`, `graduation-cap`,
  `briefcase`, `laptop`, `clock`, `calendar`, `coffee`, `dumbbell`, `stethoscope`, `piggy-bank`, `gift`, `plane`,
  `home`, `sparkles`, `handshake`, `trophy`, `smile`.
- Media ref: `{ "media_id": "uuid" }` pointing to an upload of this company (§3.4); `null` when absent.

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
draft (so the editor can render it). 404 `company_not_found` when the user is not a member.

### 3.2 `PUT /v2/me/company/site/draft`
Body: full site document. `If-Match: "<draft_version>"` required (428 `precondition_required` without it).
- 200 same shape as 3.1 with the new version/ETag.
- 412 `version_conflict` with the current body (same shape as 3.1) — the client never merges.
- 422 `validation_error`, `fields: [{ "field": "blocks[3].content.items[0].title", "code": "too_long" | "required" |
  "invalid" | "unknown_key" | "duplicate" | "not_allowed" }]` — nothing is written.
- 409 `slug_taken` / 422 `slug_reserved` with `field: "slug"`.
- Unreferenced media are kept (garbage collection is a later concern).

### 3.3 `POST /v2/me/company/site/publish` and `POST /v2/me/company/site/unpublish` (owner only)
- `publish`: `If-Match: "<draft_version>"` — publishes exactly that version. 200 same shape as 3.1. 412 if the draft
  changed. 403 `forbidden_role` for non-owners. 422 `publish_blocked` with
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

## 6. Open points for the backend session

1. Media public URL strategy (§3.4).
2. Redirect style for old slugs (§4.1).
3. Whether to store the published snapshot as a copy (recommended) or a version pointer.
4. Rich-text validator reuse from vacancy drafts for `story.body`.
