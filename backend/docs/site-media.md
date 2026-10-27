# Company site images: disk or private S3

Only site images use this selection. Candidate CV storage and `CV_STORAGE_ROOT`
semantics are unchanged. The frontend always uses the API-relative capability URL
`/v2/company-sites/media/{id}`, never an S3 URL or a presigned URL.

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

Images remain limited to 5,242,880 bytes. S3 reads buffer at most that limit plus
one sentinel byte before public headers are written; broken/oversized reads fail
closed. Successful responses use the DB content type and length, `nosniff`, CSP
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
go test -count=1 -tags=integration \
  ./internal/features/companysites/infrastructure/storage/s3 -run '^TestMinIOBootstrap$'
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
go test -count=1 -tags=integration \
  ./internal/features/companysites/infrastructure/storage/s3 -run TestMinIO
# Supply an isolated migrated/test database; harness applies embedded migrations.
DRAFT_TEST_DATABASE_URL='postgres://draft_test:draft_test@127.0.0.1:32776/draft_test?sslmode=disable' \
  go test -count=1 -tags=integration ./cmd/api -run TestCompanySiteS3
```

Coverage: put/get/delete, random keys/prefix, S3 HEAD size, denied anonymous object
access, not-found, near-5-MiB object, unreachable endpoint to sanitized domain
errors, and real-router multipart upload/public GET with exact bytes and headers.
Unit tests separately exercise fake S3 failures, read bounds and config guards.
