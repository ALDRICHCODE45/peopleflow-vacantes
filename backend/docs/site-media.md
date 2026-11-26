# Company site media: disk or private S3

Site images and hero videos use this selection. Candidate CV storage and `CV_STORAGE_ROOT`
semantics are unchanged. The frontend always uses the API-relative capability URL
`/v2/company-sites/media/{id}`, never an S3 URL or a presigned URL.

## Kinds and image rules

| kind | formats | px per side | used by (contract §2.1, §2.3) |
| --- | --- | --- | --- |
| `cover` | JPEG, PNG, WebP | 200–6,000 | `hero.cover`, `style.image` |
| `gallery` | JPEG, PNG, WebP | 200–6,000 | gallery items, `hero.images`, `areas.overrides[].photo` |
| `portrait` | JPEG, PNG, WebP | 200–6,000 | testimonial and team photos |
| `story` | JPEG, PNG, WebP | 200–6,000 | `story.image` |
| `logo` | PNG, WebP (alpha kept) | 64–6,000 | `logos.items[].image` (sections v2) |
| `hero_video` | MP4 (`video/mp4`) | from `tkhd`, 1–16,384 or unknown (`null`) | `hero.background_video` (slice B, contract §2.4) |

Every kind is detected by magic bytes, limited to 5,242,880 bytes and stripped of
EXIF/XMP/text chunks without re-encoding (`application.PrepareMediaKind`). The
database mirrors the rules: migration 00066 (`company_site_logo_media`) widened
`company_site_media_kind_check`, made the width/height CHECKs 64 px for `logo` and
200 px otherwise, and added `company_site_media_logo_format_check` (PNG/WebP only).
Its Down refuses while any `logo` row exists. A saved document references media by
company **and** kind, so a logo can never be used as a cover and vice versa.

## Hero videos (slice B)

`kind=hero_video` goes through the same multipart endpoint. The handler streams the
file part to a temporary spool (`os.CreateTemp` in `$TMPDIR`, mode 0600, at most
20,971,520 + 1 bytes, removed on every path); a file part sent before the `kind`
field is kept in memory up to 5 MiB and continues into the spool past that. The
request envelope is 20 MiB + 64 KiB; the read/write deadlines of one video upload
or download are extended to 2 minutes. Validation (`application.InspectVideo`) is
structural and dependency-free: `ftyp` first with an accepted brand (`isom`, `iso2`,
`mp41`, `mp42`, `avc1`), top-level boxes tiling the file, `moov` before or after
`mdat`, `mvhd` (version 0 or 1) with non-zero timescale and duration, dimensions
from the first `vide` track's `tkhd`. Hostile input is bounded: every box size is
checked against its parent (32-bit, 64-bit `largesize`, size 0 = to the end),
at most 1,024 top-level boxes and 4,096 box headers in total, only
`moov/trak/mdia/hdlr` is descended, fields are read with `ReadAt` (never the whole
box). Codes: 415 `unsupported_media_type`, 413 `payload_too_large`, 422
`video_too_long` (`data {max_ms, duration_ms}`), 422 `video_invalid`. No ffmpeg:
codecs and audio are not verified.

Storage is file-first: the upload is stored (`Storage.PutStream`) before the short
transaction that re-checks the 300-media quota under the company lock and writes
the row; any later failure deletes the object. Migration 00067
(`company_site_hero_video_media`) adds the nullable `duration_ms` (required and
1..30000 iff `hero_video`, NULL otherwise), makes width/height nullable only for
`hero_video` (both or neither: `company_site_media_dimensions_check`), allows
`video/mp4` only with `hero_video` (`company_site_media_video_format_check`) and a
20 MiB byte size for videos (5 MiB for images). Its Down refuses while any
`hero_video` row exists and restores the 00066 schema under the same names.

## Serving and Range

`GET /v2/company-sites/media/{id}` uses `http.ServeContent` for every kind: one
`Range` (first-last, `N-`, `-N`) → 206 with `Content-Range`; none → 200; both with
`Accept-Ranges: bytes`. An unsatisfiable range → 416 `Content-Range: bytes */size`,
`no-store`, empty body; several ranges → 200 with the whole file. Images are opened
whole (`Storage.Open`: the file on disk, or the bounded S3 buffer below); videos
through `Storage.OpenRange`: the file on disk, or a lazy S3 reader whose `Prefetch`
issues one ranged `GetObject` for exactly the response bytes right before the
status is written (a missing key still answers 404 `no-store`, other failures 500)
and streams the body. Video S3 transfers use a client without a whole-request
timeout (20 s to response headers), bounded by the request context.

Disk mode uses its own adapter (`infrastructure/storage/disk`) on `CV_STORAGE_ROOT`
with the flat random 64-hex layout the CV adapter used for site images, so files
written before slice B stay readable. Because the root is shared, the CV
reconciliation keeps every key referenced by `company_site_media`.

## Configuration

| Variable | Default | Meaning / example |
| --- | --- | --- |
| `SITE_MEDIA_STORAGE` | `disk` | `disk` or `s3` |
| `SITE_MEDIA_S3_BUCKET` | empty | Required in S3 mode, e.g. `peopleflow-site-images` |
| `SITE_MEDIA_S3_REGION` | empty | Required in S3 mode, e.g. `us-east-1` |
| `SITE_MEDIA_S3_PREFIX` | empty | Optional relative prefix, e.g. `company-sites/v1/` |
| `SITE_MEDIA_S3_ENDPOINT` | empty | Local/MinIO origin, e.g. `http://127.0.0.1:9000`; forbidden when `APP_ENV=production` |
| `SITE_MEDIA_S3_FORCE_PATH_STYLE` | `false` | Optional boolean; use `true` for local MinIO |

Disk mode reuses the existing private `CV_STORAGE_ROOT`. Without that root, media
storage is disabled as before. S3 mode works independently of the CV root. S3-only
settings in disk mode, missing bucket/region, malformed names/prefix/origin or a
non-boolean path-style setting fail startup with a static, value-free error.
Prefixes permit letters, digits, slash, underscore and hyphen (no leading slash,
empty segments or traversal). The adapter adds one slash before the random key.

Credentials are **only** resolved by the AWS SDK default credential chain:
`AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` (and optional `AWS_SESSION_TOKEN`),
shared AWS configuration, or workload/IAM roles. Use an IAM role in deployment.
No credential is stored in application config. The startup log allowlists only
mode/bucket/region/prefix; SDK request logging is disabled. Provider errors are
replaced by domain sentinels without wrapping URLs, keys, request IDs or secrets.

Endpoint policy is separate from credential discovery: production rejects
`SITE_MEDIA_S3_ENDPOINT`, `AWS_ENDPOINT_URL`, `AWS_ENDPOINT_URL_S3`, and loaded
shared-config `endpoint_url`/service endpoint settings at startup. The production
S3 client has no custom base endpoint and uses the standard AWS resolver for the
configured region. Outside production, inherited SDK endpoint settings are
ignored; **only `SITE_MEDIA_S3_ENDPOINT`** can override the S3 endpoint.

Provision a **private** production bucket separately. Grant the API role only:

- `s3:PutObject`
- `s3:GetObject` (also authorizes HeadObject)
- `s3:DeleteObject`

Scope these object actions to
`arn:aws:s3:::peopleflow-site-images/company-sites/v1/*` (or the chosen prefix).
Also grant `s3:ListBucket` on the **bucket ARN**, **without** an `s3:prefix`
condition. AWS only reports an absent object as 404/NoSuchKey when the caller holds
ListBucket on the bucket; a GetObject request carries no list-prefix context, so a
prefix-conditioned grant never matches it and absent keys would answer
403/AccessDenied (HTTP 500 here). Example bucket statement:

```json
{
  "Effect": "Allow",
  "Action": "s3:ListBucket",
  "Resource": "arn:aws:s3:::peopleflow-site-images"
}
```

This lets the API role list every key in the bucket, so dedicate the bucket to site
images (keys are random and the bucket is private). The API itself never lists. **403/AccessDenied remains storage-unavailable**
(generic HTTP 500), never not-found: hiding a real permission error as 404 would
mask deployment problems. 404/NoSuchKey/NotFound maps to 404/no-store.
No public policy, ACL or CreateBucket permission is needed by the API. Enable S3
Block Public Access. The application never sends an ACL or creates a bucket at
startup. Encryption/retention/backups are operator responsibilities; do not
configure lifecycle deletion of referenced images.

Images remain limited to 5,242,880 bytes. S3 image reads buffer at most that limit
plus one sentinel byte before public headers are written; broken/oversized reads
fail closed. Hero videos never use that buffered read (see «Serving and Range»). Successful responses use the DB content type and length, `nosniff`, CSP
`default-src 'none'; sandbox` and `public, max-age=31536000, immutable`. Unknown
media IDs or missing S3 keys return 404 with `Cache-Control: no-store`; other
storage failures return generic `internal_error` without provider details.

Changing mode/bucket does **not** migrate existing objects. Keep the DB and object
storage together; changing the prefix affects new uploads only (existing DB keys
include their prefix). Back up both before an operator-led migration.

## Local MinIO (no AWS CLI or mc image required)

The separate compose file never starts or changes the existing Postgres compose.
It builds MinIO from AGPL-3.0 source for **local development/integration only**;
it is not shipped with the API. The Dockerfile verifies release
`RELEASE.2025-10-15T17-29-55Z` resolves exactly to commit
`9e49d5e7a648f00e26f2246f4dc28e6b07f8c84a` before building with Go 1.24.8 and
CGO disabled. Runtime is Alpine, UID/GID 10001, with a named `/data` volume and
an HTTP liveness check. First build downloads source and modules and can take
several minutes. No prebuilt MinIO registry image is required.

From the repository root:

```sh
docker compose -f backend/docker-compose.minio.yml up -d --build
```

API: `127.0.0.1:9000`; console: `127.0.0.1:9001`. These credentials are disposable,
local-only and deliberately checked into the separate compose file:

```sh
export APP_ENV=local
export AWS_ACCESS_KEY_ID=site-local
export AWS_SECRET_ACCESS_KEY=site-local-disposable-only
export SITE_MEDIA_S3_TEST_ENDPOINT=http://127.0.0.1:9000
cd backend
# Tiny bucket-bootstrap helper: creates site-media if absent, no public policy/ACL.
# Re-runnable; needs only MinIO, not Postgres. Local root credentials permit CreateBucket.
make test-integration PKG=./internal/features/companysites/infrastructure/storage/s3 RUN='^TestMinIOBootstrap$'
```

For a live API on port 8090, retain your normal migrated `DATABASE_URL` and
`IDENTITY_JWT_*` configuration (see the identity docs), then run from `backend/`:

```sh
export APP_ENV=local
export SITE_MEDIA_STORAGE=s3
export SITE_MEDIA_S3_BUCKET=site-media
export SITE_MEDIA_S3_REGION=us-east-1
export SITE_MEDIA_S3_PREFIX=company-sites/
export SITE_MEDIA_S3_ENDPOINT=http://127.0.0.1:9000
export SITE_MEDIA_S3_FORCE_PATH_STYLE=true
PORT=8090 go run ./cmd/api
```

The API does not bootstrap buckets; run the helper first. Do not reuse these
local root credentials with any deployed bucket. An unset `CV_STORAGE_ROOT`
still disables CV storage without disabling S3 site images.

## Validation

Bootstrap and integration helpers **refuse `APP_ENV=production` before loading
SDK configuration or making requests**. The endpoint must be an HTTP(S) origin
with host exactly `127.0.0.1`, `localhost` or `::1`; remote hosts, credentials,
paths, queries and fragments are rejected. Outside production, tests skip
explicitly unless `SITE_MEDIA_S3_TEST_ENDPOINT` is set. Integration credentials
use the same SDK default chain as production, not test-only injection.
The helper and object tests use the private `site-media` bucket and random test
prefixes, delete their objects, and leave the bucket/container running.

```sh
# With the local AWS_* and SITE_MEDIA_S3_TEST_ENDPOINT exports above:
make test-integration PKG=./internal/features/companysites/infrastructure/storage/s3 RUN='TestMinIO'
# Supply an isolated migrated/test database; harness applies embedded migrations.
DRAFT_TEST_DATABASE_URL='postgres://draft_test:draft_test@127.0.0.1:32776/draft_test?sslmode=disable' \
  make test-integration PKG=./cmd/api RUN='TestCompanySiteS3'
```

Coverage: put/get/delete, random keys/prefix, S3 HEAD size, denied anonymous object
access, not-found, near-5-MiB object, unreachable endpoint to sanitized domain
errors, and real-router multipart upload/public GET with exact bytes and headers;
`TestCompanySiteS3HeroVideoRange` uploads a > 5 MiB MP4 (built box by box by
`testsupport/mp4fixture`, no ffmpeg) through the router and checks 200/206/416.
Unit tests separately exercise fake S3 failures, read bounds and config guards.
