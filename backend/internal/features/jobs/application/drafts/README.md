# `drafts` — private vacancy draft persistence port

This package owns the **only** interface the HTTP layer needs for private
vacancy draft create/read/explicit-save. It performs no I/O itself.

## Port

```go
type Result struct {
    Body     []byte // complete read envelope, ready to write
    ETag     string // exact ETag response-header value
    Replayed bool   // true only on a POST idempotent replay
}

type Store interface {
    Create(ctx context.Context, companyID, actorID uuid.UUID, key string, body []byte) (Result, error)
    Get(ctx context.Context, companyID, actorID, id uuid.UUID) (Result, error)
    Save(ctx context.Context, companyID, actorID, id uuid.UUID, ifMatch string, present bool, body []byte) (Result, error)
}
```

`companyID` is the session company and `actorID` is the authenticated user.
The adapter re-evaluates authorization transactionally; never pass a role from
request context.

## Error projection

Match with `errors.Is` and project the documented code:

| Sentinel | HTTP |
| --- | --- |
| `ErrUnauthenticated` | `401 unauthenticated` |
| `ErrForbidden` | `403 forbidden` |
| `ErrCompanyInactive` | `403 company_inactive` |
| `ErrCompanyNotActive` | `409 company_not_active` |
| `ErrNotFound` | `404 not_found` |
| `ErrPayloadTooLarge` | `413 payload_too_large` |
| `ErrInvalidRequest` | `400 invalid_request` |
| `ErrValidation` | `400 validation_error` |
| `ErrEmptyPatch` | `400 empty_patch` |
| `ErrIdempotencyKeyRequired` | `400 idempotency_key_required` |
| `ErrInvalidIdempotencyKey` | `400 invalid_idempotency_key` |
| `ErrIdempotencyConflict` | `409 idempotency_conflict` |
| `ErrPreconditionRequired` | `428 precondition_required` |
| `ErrVersionConflict` | `412 version_conflict` |
| `ErrVersionOverflow` | `500 internal_error` (server invariant) |

`Body` is the full read envelope: `schema_version`, `id`, `status`,
`principal_recruiter_id`, decimal-string `version`, UTC microsecond RFC3339
`created_at`/`updated_at`, and `fields` carrying every writable field plus the
derived `description_plain` and `requester.name`.

## Caller responsibilities

- Validate the `Idempotency-Key` presence/shape only if you also project
  `ErrIdempotencyKeyRequired` / `ErrInvalidIdempotencyKey`; the adapter
  re-validates.
- Set `Cache-Control: no-store`, `ETag: Result.ETag` and
  `Idempotency-Replayed: true|false` (create only).
- Do not attempt to reconstruct `ETag`s; treat them as opaque.
