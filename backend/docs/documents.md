# Placement and vacancy documents: storage, configuration and reconciliation

Internal process documents of a vacancy or of one candidate participation (contracts, CVs, scans, spreadsheets). The
behavior of the routes (authorization, scopes, versions, replacement links, errors, audit) is the contract
[`docs/contracts/placement-vacancy-documents-v1.md`](../../docs/contracts/placement-vacancy-documents-v1.md); this page is
the operator's side: which variables to set, how files are stored, what the periodic cleanup does and the limits that apply.
Candidate CV storage (`CV_STORAGE_ROOT`, [candidate-cvs.md](candidate-cvs.md)) and site images
([site-media.md](site-media.md)) are separate and unchanged: documents never share their root, bucket prefix or keys.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `DOCUMENT_STORAGE` | `disk` | `disk` or `s3` |
| `DOCUMENT_STORAGE_ROOT` | empty | `disk` only: **absolute** private directory. Empty = documents storage disabled. Must differ from `CV_STORAGE_ROOT` |
| `DOCUMENT_S3_BUCKET` | empty | `s3` only, required: bucket name, e.g. `peopleflow-documents` |
| `DOCUMENT_S3_REGION` | empty | `s3` only, required: e.g. `us-east-1` |
| `DOCUMENT_S3_PREFIX` | `documents/v1` | `s3` only: relative key prefix (letters, digits, `/`, `_`, `-`; no leading slash, no empty segment). A trailing slash is trimmed. Must differ from `SITE_MEDIA_S3_PREFIX` when the bucket is shared |
| `DOCUMENT_S3_ENDPOINT` | empty | `s3` only, **non-production only** (MinIO): an `http(s)` origin without credentials, path, query or fragment. Forbidden when `APP_ENV=production` |
| `DOCUMENT_S3_FORCE_PATH_STYLE` | `false` | `s3` only: boolean, `true` for MinIO |
| `DOCUMENT_S3_TEST_ENDPOINT` | empty | **tests only**: loopback MinIO origin that enables the `integration`-tagged S3 tests; never read by the API |

A mixed configuration fails startup with a static message that never echoes a value: any `DOCUMENT_S3_*` with
`DOCUMENT_STORAGE=disk`, `DOCUMENT_STORAGE_ROOT` with `s3`, an invalid bucket, region, prefix, endpoint or boolean, and the
same root as `CV_STORAGE_ROOT` or the same bucket and prefix as site media.

**Credentials are never configuration.** S3 mode resolves them only through the AWS SDK default chain (an IAM task role in
deployment; `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` for a disposable local MinIO). SDK request logging is disabled and
provider errors are replaced by domain errors, so a bucket, key or request id never reaches a response or a log line.
The startup log prints only `enabled`, `mode`, `bucket`, `region` and `prefix`.

### Not configured

With `DOCUMENT_STORAGE=disk` and no `DOCUMENT_STORAGE_ROOT` the storage is **disabled** and the rest of the API is unaffected:

- the routes that only touch rows keep working: list, overview, version list, document sources, link and unlink, the
  stakeholder vacancies list, and delete of a document (rows first, files best effort);
- every route that moves a file (upload, replace, download of a document, of a version or through a link) answers
  `503 document_storage_unavailable` after its usual gates (a refused caller or an unknown document still gets its 403 or 404);
- the reconcile job is **not started**.

## Local disk setup

```sh
export DOCUMENT_STORAGE=disk
export DOCUMENT_STORAGE_ROOT=/var/lib/peopleflow/documents   # absolute, not the CV root
```

The directory is created `0700` when missing; files are `0600`, named by 64 random hex characters (no company, vacancy,
candidate or file name in the path), written with `O_EXCL` and `fsync`, through `os.Root` so a key can never leave the
directory. A partial file is removed on any error. Disk is meant for development and a single host: **ephemeral disks
(Fargate) lose the files**, which is why the AWS test environment uses S3.

## S3 setup

```sh
export DOCUMENT_STORAGE=s3
export DOCUMENT_S3_BUCKET=peopleflow-documents
export DOCUMENT_S3_REGION=us-east-1
export DOCUMENT_S3_PREFIX=documents/v1        # optional
```

- A **private** bucket (block public access; the adapter sets no ACL and never builds a public or presigned URL: downloads
  stream through the API so the audit row is written before the first byte).
- Objects are `<prefix>/<64 hex>`. Uploads are streamed with the SDK's multipart uploader (5 MiB parts, concurrency 2): a
  10 MiB file is never buffered whole in memory; downloads return the `GetObject` body as is.
- IAM task role, no static keys, least privilege: `s3:PutObject`, `s3:GetObject`, `s3:DeleteObject` on
  `arn:aws:s3:::<bucket>/<prefix>/*`, and `s3:ListBucket` on `arn:aws:s3:::<bucket>` restricted to the prefix
  (`s3:prefix` condition). `Reconcile` needs the list permission; multipart uploads also need `s3:AbortMultipartUpload` on the
  same object ARN.
- Add a bucket lifecycle rule that aborts incomplete multipart uploads (for example after 1 day): a crash in the middle of a
  streamed upload otherwise leaves invisible parts that cost storage and that `Reconcile` cannot list.
- Keep the bucket separate from, or at least under a different prefix than, site media; back up the bucket and the database
  together (a version row whose object is gone can no longer be downloaded).

### Local MinIO (development and integration tests)

The MinIO of [site-media.md](site-media.md#local-minio-no-aws-cli-or-mc-image-required) (`backend/docker-compose.minio.yml`)
works for documents too. Use its disposable root credentials only locally:

```sh
export APP_ENV=local
export AWS_ACCESS_KEY_ID=site-local
export AWS_SECRET_ACCESS_KEY=site-local-disposable-only
export DOCUMENT_STORAGE=s3
export DOCUMENT_S3_BUCKET=document-files          # create it first: the API never creates buckets
export DOCUMENT_S3_REGION=us-east-1
export DOCUMENT_S3_ENDPOINT=http://127.0.0.1:9000
export DOCUMENT_S3_FORCE_PATH_STYLE=true
```

The tagged tests bootstrap the private `document-files` bucket through the SDK (no AWS CLI). Setting
`DOCUMENT_S3_TEST_ENDPOINT=http://127.0.0.1:9000` enables them; without it they skip. Bootstrap and tests refuse
`APP_ENV=production` and any endpoint that is not a loopback origin.

## Reconciliation of orphan files

A document file reaches storage **before** its rows exist (the upload streams first, then one short transaction writes the
rows), and a delete removes the rows first and the files after the commit. A crash or a storage outage in between leaves a
file that no `placement_document_versions.storage_key` references. `Reconcile` removes those.

**Rule (D25).** It lists the adapter's namespace and deletes an object only if **no version row references its key and it
is at least one hour old** (`OrphanGrace`). A younger object may belong to an upload in flight, so it is never judged. An
object without a modification time or dated in the future is kept. A failed listing, lookup or deletion stops the run
(fail closed: nothing is deleted on doubt). The run never holds a transaction or a row lock.

**Schedule (Q8, accepted default).** The API process runs it **once right after startup and then every 24 hours** in a
background goroutine (`cmd/api/documents_reconcile.go`, `documents.ReconcileScheduler`):

- the first run happens without waiting for a tick; the 24 h ticker starts after it, so a long run never queues another;
- every run takes a **Postgres session advisory lock** (`pg_try_advisory_lock`, key `0x646f63735f726563`, the ASCII of
  `docs_rec`) on a dedicated pooled connection. With several tasks only one sweeps; the others log
  `documents reconcile skipped` (`reason=lock_held`) and try again at their next tick. The lock is released when the run
  ends (also on error, panic or shutdown); if the release cannot be confirmed the connection is closed so Postgres drops it.
  While a run is in progress it holds **one** pooled connection (plus one for the lookups), so the pool needs at least two;
- shutdown (`SIGTERM`/`SIGINT`) cancels the run in progress and waits for the goroutine before the pool is closed;
- failures are logged as `documents reconcile failed` with `code_class=internal_error` only: no error text, because a
  filesystem error carries a file name. A failed run, a failed lock attempt and even a panic never stop the process or the
  schedule; the next tick tries again. A success logs `documents reconcile finished` with `duration_ms`;
- disabled (no goroutine, no lock) while the documents storage is not configured.

The CV `Reconcile` (candidates) also keeps any key a document version references, in case the two ever shared a root.

## Limits and formats

| Limit | Value |
| --- | --- |
| File size | 10 MB = 10 485 760 bytes per file (`413 payload_too_large`) |
| Whole upload request | 10 485 760 + 65 536 bytes (multipart overhead); the BFF applies the same cap |
| Documents per vacancy | 50, files plus links |
| Documents per candidate participation | 20, files plus links |
| Versions per document | 25 |
| Display name | 1 to 120 characters (NFC, whitespace collapsed); default is the file name without its known extension, or `Documento` |

| Format | Extensions | Content type | Checked by |
| --- | --- | --- | --- |
| `pdf` | `.pdf` | `application/pdf` | `%PDF-` header |
| `docx` | `.docx` | `application/vnd.openxmlformats-officedocument.wordprocessingml.document` | ZIP central directory with Word parts |
| `xlsx` | `.xlsx` | `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` | ZIP central directory with Excel parts |
| `jpg` | `.jpg`, `.jpeg` | `image/jpeg` | JPEG signature |
| `png` | `.png` | `image/png` | PNG signature |

The content is inspected by its **magic bytes** (the first 16 bytes and a rolling 2 MiB tail, so a 10 MB body is never held
whole), never by the client's MIME type; a file whose content disagrees with its extension is
`400 document_content_mismatch`, an unknown extension `415 unsupported_media_type`, an empty file `400 validation_error` (`file`/`empty`).
Legacy `.doc` and `.xls` are not accepted. Files are always served as `Content-Disposition: attachment` with
`X-Content-Type-Options: nosniff`, never inline. Malware scanning is not part of v1 (decision recorded in the contract).

## Verification

```sh
cd backend
make test PKG="./internal/features/documents/... ./internal/runtime/config ./cmd/api"
```

Integration tests need the isolated `draft_test` database (`DATABASE_URL` and `DRAFT_TEST_DATABASE_URL`, migrations applied):

```sh
make test PKG="./internal/features/documents/... ./cmd/api" TEST_FLAGS="-tags=integration -p 1 -run 'Document|Reconcile|AdvisoryLock'"
```

`TestDocumentsEndToEnd_LocalStorage` and `TestDocumentsEndToEnd_S3Storage` (the latter only with
`DOCUMENT_S3_TEST_ENDPOINT`) run the same flow through the production router: upload, list, overview, replace, versions,
download a version, link from a replacement, delete, and a reconcile that leaves no orphan.
