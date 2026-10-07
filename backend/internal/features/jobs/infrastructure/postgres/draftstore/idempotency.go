package draftstore

import (
	"bytes"
	"crypto/sha256"
	"crypto/subtle"
	"errors"
	"fmt"
)

// Persisted idempotency fingerprint algorithm identifiers.
//
// Migration 00013 adds the `fingerprint_algorithm` column with the legacy
// identifier as its NOT NULL DEFAULT, so rows written before 00013 — and rows
// written by a pre-00013 binary that does not name the column at all — are
// tagged legacy without reinterpreting their stored `fingerprint` bytes. A
// replay is dispatched by this persisted tag, never by guessing the
// representation from the fingerprint length or the schema version.
const (
	// FingerprintAlgorithmLegacyCanonical is the pre-00013 representation: the
	// `fingerprint` column holds the raw canonical go-json-v1 writable bytes.
	FingerprintAlgorithmLegacyCanonical = "go-json-v1+canonical-bytes"
	// FingerprintAlgorithmSHA256 is the current representation: the
	// `fingerprint` column holds the 32-byte SHA-256 digest of the canonical
	// go-json-v1 writable bytes.
	FingerprintAlgorithmSHA256 = "go-json-v1+sha256"
)

var (
	// ErrUnknownFingerprintAlgorithm means a stored idempotency row is tagged
	// with a representation this binary cannot evaluate. It is a server-side
	// invariant failure that fails closed as an internal error with no write,
	// never a silent match or conflict.
	ErrUnknownFingerprintAlgorithm = errors.New("draftstore: unknown idempotency fingerprint algorithm")
	// ErrMalformedFingerprint means a stored idempotency row is tagged with a
	// digest representation but its `fingerprint` value is not exactly the
	// expected width. It fails closed as an internal error with no write.
	ErrMalformedFingerprint = errors.New("draftstore: malformed idempotency fingerprint")
)

// fingerprintDigest returns the value persisted in `fingerprint` for a new
// idempotency record: the SHA-256 digest of the canonical normalized write
// DTO. The canonical bytes themselves are still stored in `job_drafts.fields`;
// only the idempotency comparison value is hashed.
//
// The digest is fixed-width, so the persisted value never depends on the DTO's
// canonical length.
func fingerprintDigest(canonical []byte) []byte {
	sum := sha256.Sum256(canonical)
	return sum[:]
}

// fingerprintsMatch reports whether a stored idempotency fingerprint, read
// under its persisted algorithm, is equivalent to the incoming canonical
// writable bytes of the same request.
//
// It dispatches strictly on the persisted algorithm: the legacy representation
// compares the stored canonical bytes directly, the sha256 representation
// compares the digest in constant time, and anything else fails closed. A
// non-nil error always means the stored row cannot be evaluated safely; the
// caller must not treat it as a conflict or a replay and must not write.
func fingerprintsMatch(algorithm string, stored, canonical []byte) (bool, error) {
	switch algorithm {
	case FingerprintAlgorithmLegacyCanonical:
		return bytes.Equal(stored, canonical), nil
	case FingerprintAlgorithmSHA256:
		if len(stored) != sha256.Size {
			return false, fmt.Errorf("%w: algorithm %q has a %d-byte digest, want %d",
				ErrMalformedFingerprint, algorithm, len(stored), sha256.Size)
		}
		digest := sha256.Sum256(canonical)
		return subtle.ConstantTimeCompare(stored, digest[:]) == 1, nil
	default:
		return false, fmt.Errorf("%w: %q", ErrUnknownFingerprintAlgorithm, algorithm)
	}
}
