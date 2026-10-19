# Candidate CV library (P2b)

Private, candidate-owned documents. Contract: design §10.5; identity: §11.
All routes use `NoStore → RequireAuth → RequireCandidateRole` (live database role).
No token → 401; no account → `403 account_required`; recruiter → `403 wrong_role`.
Every private response, including gate failures, has `Cache-Control: no-store`.
Foreign and removed library IDs are indistinguishable from missing IDs (404).

## API

| Method | Path | Success |
| --- | --- | --- |
| GET | `/v2/me/cvs` | 200 `{items:[cv],limits}`; newest first |
| POST | `/v2/me/cvs` | 201 `cv` |
| PATCH | `/v2/me/cvs/{id}` | 200 `cv`; body exactly `{name}` |
| DELETE | `/v2/me/cvs/{id}` | 204; no body |
| GET | `/v2/me/cvs/{id}/file` | 200 attachment |

`cv` is exactly `{id,name,size,content_type,uploaded_at,in_use}`.
`uploaded_at` is UTC RFC3339; `in_use` means a participation references the version.
`limits` is exactly:

```json
{"max_cvs":10,"max_bytes":5242880,"content_types":["application/pdf","application/vnd.openxmlformats-officedocument.wordprocessingml.document"]}
```

Upload uses multipart/form-data: exactly one file part named `file`, optionally one
text part `name`; unknown/repeated parts are rejected before storage. Name defaults
to the basename, including extension (both slash conventions removed). Labels use
NFC, trimmed/collapsed Unicode whitespace, reject non-whitespace controls, and must
have 1–120 code points. Rename only changes that label, never the immutable version.
No upload idempotency: retries create another library entry.

File limit is exactly 5,242,880 bytes. The raw multipart budget additionally permits
64 KiB of envelope overhead; name part reading is bounded. Multipart is streamed
into bounded memory, never spooled into a system temporary directory.
Client MIME headers are not authority. Supported extensions are `.pdf` and `.docx`
(case-insensitive), and content must match: `%PDF-` or a ZIP containing both
`[Content_Types].xml` and `word/document.xml`. ZIP central-directory inspection is
bounded (1,024 entries; required markers must be nonempty, unencrypted and at most
8 MiB expanded each). Entries are never decompressed or extracted.

| Error | Status |
| --- | --- |
| `invalid_request` (multipart/JSON/name/path shape) | 400 |
| `cv_content_mismatch` (allowed extension, wrong content) | 400 |
| `cv_unsupported_type` (unsupported extension) | 415 |
| `cv_too_large` | 413 |
| `cv_library_full` | 409 |
| `cv_storage_unavailable` (storage not configured) | 503 |
| `not_found` (own-only lookup) | 404 |

Errors use only `{error,code}`. JSON rename bodies also have the existing 1 MiB
transport budget (`413 payload_too_large`). Downloads use stored MIME,
`Content-Disposition: attachment`, `Content-Length` and `X-Content-Type-Options:
nosniff`; no static file-serving route exists.

## Storage and operations

**`CV_STORAGE_ROOT` is optional.** When unset/empty, the API starts normally;
all `/v2/me/cvs*` methods return `503 cv_storage_unavailable` with `{error,code}`
and `Cache-Control: no-store`, after authentication and the candidate-role gate
(401/403 take precedence). Applying, screening and the candidate applications list
remain available because they do not access file storage. A set-but-invalid root
still fails startup without echoing the configured value.

To enable CV routes, set it to an absolute, dedicated private directory outside any
web/static root. The filesystem adapter opens an `os.Root`, permits only generated
64-character lowercase random hexadecimal keys, creates objects with mode 0600,
and creates its root with mode 0700. Existing directory ownership/permissions,
backups and disk capacity remain operator responsibilities. The path is not logged.
Storage is behind the `cvs.Storage` port; HTTP never knows keys or disk paths.

Migration **00021** adds immutable version metadata and independently soft-removable
library labels; migration **00022** references the version, not its mutable label.
Candidate-row locking serializes uploads (maximum 10), removal and apply. Upload
writes the file first and then rows. Ordinary row-write failure compensates by
removing the file, even after request cancellation. A commit-acknowledgement failure
is uncertain: do not delete a possibly committed document; reconciliation resolves it.

`(*cvs.Library).Reconcile(ctx)` is callable (not scheduled). It takes a database-wide
exclusive advisory transaction lock; uploads hold the corresponding shared lock
through file creation and commit. Thus it cannot remove an in-flight upload. It
removes files with no live library reference and no participation reference, including
retryable cleanup of removed unused CVs. Failed database lookups never authorize
file deletion. Unused removal deletes the file after committing library removal;
failed filesystem cleanup is surfaced and can be retried by reconciliation.
Used versions remain private and retained after library removal. Final retention
is an unresolved privacy/product decision, not an automatic deletion policy.
Both migration down paths refuse while their new data exists; no silent data loss.

## §10.5 test map

| Tests | Rules |
| --- | --- |
| `TestInspect`, `TestInspectDOCXDirectoryHardeningWithoutOpeningEntries`, `TestNormalizeName` | PDF/DOCX signatures, spoofed extensions/arbitrary ZIP, size and Unicode label limits; ZIP entry count, marker size/encryption/duplicates, instrumented proof that no entry opens |
| `TestLocalPrivateRandomKeysAndTraversal`, `TestCVStorageConfig` | temporary private root, random keys, traversal rejection, round-trip/delete, explicit absolute configuration |
| `TestReconcilePreservesReferencedFilesAndFailsClosed` | executable orphan reconciliation; keeps live/used files; failed reference lookup never authorizes deletion |
| `TestUploadTransport` | exact six-key CV response, no-store, multipart cardinality/unknown parts, oversize and type codes; rejected transport never reaches storage |
| `TestLibraryHTTPExactShapesAndAttachment`, `TestUploadLibraryFullIsConflict` | exact list/limits and attachment headers, label normalization/strict rename, delete 204, missing/foreign errors, library-full code |
| `TestP2bPrivateRoutesLiveCandidateGates`, `TestCVStorageDisabledRoutesAndUnrelatedServices` | every private method rejects anonymous/recruiter/no-account first; disabled CV routes return exact 503 envelope/no-store, unrelated services still run |
| `TestCVFailedRowWriteDeletesPrivateFile` (integration) | row failure compensates the file-first write and leaves no version |
| `TestCVLibraryLimitRemovalOrphanReconciler` (integration) | 10-entry limit, foreign rename returns not found without changing owner label, own-only removal/download, unused deletion and orphan cleanup |
| `TestParticipationAtomicReplaySnapshotAndCVRetention` (integration) | foreign CV unavailable/404, label-only rename, used-version retention |
| `TestCVReconcilerVersusUploadAdvisoryLock`, `TestCVRemovalVersusApplyCandidateLock` (integration) | force both advisory/candidate-lock orderings; committed uploads survive reconciliation; apply wins with retained version or removal wins with cv_unavailable |
| `TestCVLibraryNewestFirstAndInUseAfterApply` (integration) | deterministic newest-first library and in_use changes after apply |
| `TestMigration00021CVDownRefusesDataAndSucceedsEmpty` (integration) | real down refusal retains data/schema/version; empty down succeeds |
| `TestCandidateCVMigration` | additive schema definition |

DB tests require loopback `draft_test` via `DRAFT_TEST_DATABASE_URL`; absent means
explicit skip, not database evidence. They apply embedded migrations to an existing
isolated database; they never create a database. The parent owns isolated execution.
