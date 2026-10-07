// Package drafts declares the private vacancy draft persistence port and its
// closed error vocabulary.
//
// The port is deliberately narrow: three methods that take raw request bytes
// (create, ready-to-save patch) and a small if-match precondition, and return
// a fully rendered response Body plus its strong ETag. Everything the HTTP
// layer needs to answer the request is already projected by the adapter:
//
//   - authorization is re-evaluated transactionally inside the adapter from
//     the live user, membership and company rows; the caller must not pass a
//     role from request context;
//   - the request body is decoded with the strict draftinput composer and
//     stored as canonical, writable, normalized bytes;
//   - the response body is the complete read envelope (all writable fields
//     plus the derived description_plain and requester.name) with UTC
//     microsecond timestamps and the draft version as a decimal string;
//   - POST idempotency is persisted per (company, actor, operation, key) with
//     no TTL while the draft exists.
//
// Result is the complete projection. Body is the exact bytes to write to the
// client (already canonical). ETag is the exact value for the ETag response
// header. Replayed is true only when a POST was served from an existing
// idempotency record; callers project it as Idempotency-Replayed.
//
// Every method returns either a complete Result or a sentinel error from this
// package. The HTTP layer maps the sentinels to contract status codes exactly
// as documented on each error.
package drafts

import (
	"context"
	"errors"

	"github.com/google/uuid"
)

// Result is the complete response projection of a draft operation.
//
// Body is the canonical response envelope bytes, ready to write. ETag is the
// strong draft entity tag for the version the Body represents. Replayed is
// true only when a create was served from an existing idempotency record
// (same key, same normalized fingerprint); it is always false for Get and
// Save.
type Result struct {
	Body     []byte
	ETag     string
	Replayed bool
}

// Store is the private-draft persistence port.
//
// The adapter MUST re-evaluate authorization transactionally: it re-reads the
// live user, membership and company, holds those locks through commit and
// never trusts a role supplied by the caller. companyID is the session
// company; actorID is the authenticated user.
//
// Create persists a new draft and returns the full read envelope.
//
//   - key is the client Idempotency-Key. It is required and must be a UUID.
//   - body is the raw POST body, always {"fields": {...}}. Omitted fields
//     receive their create defaults.
//   - The creator becomes the draft principal. The create, its audit event
//     and the idempotency record commit atomically.
//   - The same key with an equivalent normalized payload replays the original
//     Body and ETag with Replayed=true, even if the draft has since advanced.
//   - The same key with a different normalized payload is a conflict.
//
// Get returns the current read envelope for an addressed draft.
//
//   - Authorization is owner or draft principal only; any other draft,
//     non-principal caller, cross-company id or missing id is indistinguishable
//     as ErrNotFound after the general auth gates.
//
// Save applies an explicit-save patch under a strong precondition.
//
//   - ifMatch is the raw If-Match header value; present reports whether the
//     request carried the header at all. A missing header is
//     ErrPreconditionRequired; a weak, list, starred or malformed value is
//     ErrInvalidRequest; a stale or foreign tag is ErrVersionConflict.
//   - The precondition is evaluated after resource authorization.
//   - body is the raw PATCH body, always {"fields": {...}} with at least one
//     key. Present fields replace fully; there is no nested merge.
//   - A no-op still passes authorization and the precondition but does not
//     increment the version, change timestamps or write an audit event.
//   - A real change increments the version and appends an audit event in the
//     same transaction.
type Store interface {
	Create(ctx context.Context, companyID, actorID uuid.UUID, key string, body []byte) (Result, error)
	Get(ctx context.Context, companyID, actorID, id uuid.UUID) (Result, error)
	Save(ctx context.Context, companyID, actorID, id uuid.UUID, ifMatch string, present bool, body []byte) (Result, error)
}

// Closed error vocabulary. Every error is a sentinel: callers match with
// errors.Is and project the documented contract code. No method returns a
// partial Result alongside a non-nil error.
var (
	// ErrUnauthenticated means the authenticated user no longer exists or is
	// tombstoned. HTTP projection: 401 unauthenticated.
	ErrUnauthenticated = errors.New("drafts: unauthenticated")
	// ErrForbidden means the caller has no current membership in the session
	// company. HTTP projection: 403 forbidden.
	ErrForbidden = errors.New("drafts: forbidden")
	// ErrCompanyInactive means the session company is missing or tombstoned.
	// HTTP projection: 403 company_inactive.
	ErrCompanyInactive = errors.New("drafts: company inactive")
	// ErrCompanyNotActive means the session company exists and is live but is
	// not active at the transactional guard. HTTP projection: 409
	// company_not_active.
	ErrCompanyNotActive = errors.New("drafts: company not active")
	// ErrNotFound means the addressed draft does not exist, belongs to another
	// company, or the caller is neither its owner nor its principal. All four
	// shapes are indistinguishable. HTTP projection: 404 not_found.
	ErrNotFound = errors.New("drafts: draft not found")
	// ErrPayloadTooLarge means the raw request body exceeded the draft body
	// budget. HTTP projection: 413 payload_too_large. A field-limit violation
	// is ErrValidation (400), never this error.
	ErrPayloadTooLarge = errors.New("drafts: payload too large")
	// ErrInvalidRequest means the request envelope is unreadable: malformed or
	// non-strict JSON, an unknown or read-only key, a duplicate key, invalid
	// UTF-8, an unsupported rich schema version, a malformed If-Match value, or
	// an idempotency key of the wrong shape when it is present but invalid.
	// HTTP projection: 400 invalid_request.
	ErrInvalidRequest = errors.New("drafts: invalid request")
	// ErrValidation means a recognized field violated its value contract,
	// including a requester id that does not belong to the same company and
	// kind. HTTP projection: 400 validation_error.
	ErrValidation = errors.New("drafts: validation failed")
	// ErrEmptyPatch means a patch body carried an empty fields object. HTTP
	// projection: 400 empty_patch.
	ErrEmptyPatch = errors.New("drafts: empty patch")
	// ErrIdempotencyKeyRequired means a create arrived without an idempotency
	// key. HTTP projection: 400 idempotency_key_required.
	ErrIdempotencyKeyRequired = errors.New("drafts: idempotency key required")
	// ErrInvalidIdempotencyKey means the idempotency key is present but is not
	// a well-formed UUID. HTTP projection: 400 invalid_idempotency_key.
	ErrInvalidIdempotencyKey = errors.New("drafts: invalid idempotency key")
	// ErrIdempotencyConflict means the idempotency key was already used with a
	// different normalized payload. The original body is never leaked. HTTP
	// projection: 409 idempotency_conflict.
	ErrIdempotencyConflict = errors.New("drafts: idempotency conflict")
	// ErrPreconditionRequired means a save arrived without an If-Match header.
	// HTTP projection: 428 precondition_required.
	ErrPreconditionRequired = errors.New("drafts: if-match precondition required")
	// ErrVersionConflict means the presented If-Match tag is stale or belongs
	// to another draft. HTTP projection: 412 version_conflict, with no editor
	// data.
	ErrVersionConflict = errors.New("drafts: draft version conflict")
	// ErrVersionOverflow means the stored draft version cannot be incremented
	// without overflowing the signed 64-bit version space. It is a server-side
	// invariant failure, not a client error: HTTP projection 500 internal_error.
	ErrVersionOverflow = errors.New("drafts: draft version overflow")
)
