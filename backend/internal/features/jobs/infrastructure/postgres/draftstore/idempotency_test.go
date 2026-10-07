package draftstore

import (
	"bytes"
	"crypto/sha256"
	"errors"
	"testing"
)

// canonicalCreateBytes builds the exact canonical writable bytes a create
// persists ({"schema_version":1,"fields":{...}}) with the approved serializer.
// It mirrors draftinput.Create.Fingerprint() without depending on the store.
func canonicalCreateBytes(t *testing.T, fields map[string]any) []byte {
	t.Helper()
	return mustCanonical(t, map[string]any{"schema_version": int64(1), "fields": fields})
}

// TestFingerprintAlgorithmIdentifiers_AreStablePersistedTags pins the two
// persisted tag strings. The legacy value is also the migration default, so a
// rename here without a migration would silently mistag old rows.
func TestFingerprintAlgorithmIdentifiers_AreStablePersistedTags(t *testing.T) {
	if FingerprintAlgorithmLegacyCanonical != "go-json-v1+canonical-bytes" {
		t.Errorf("legacy tag: want %q, got %q", "go-json-v1+canonical-bytes", FingerprintAlgorithmLegacyCanonical)
	}
	if FingerprintAlgorithmSHA256 != "go-json-v1+sha256" {
		t.Errorf("sha256 tag: want %q, got %q", "go-json-v1+sha256", FingerprintAlgorithmSHA256)
	}
}

// TestFingerprintDigest_IsSHA256OfCanonicalBytes pins the new persisted
// representation: a fixed-width 32-byte SHA-256 digest of the canonical
// normalized write DTO, never the DTO bytes themselves.
func TestFingerprintDigest_IsSHA256OfCanonicalBytes(t *testing.T) {
	canonical := canonicalCreateBytes(t, map[string]any{"title": "Backend Go"})
	digest := fingerprintDigest(canonical)

	if len(digest) != sha256.Size {
		t.Fatalf("digest length: want %d, got %d", sha256.Size, len(digest))
	}
	want := sha256.Sum256(canonical)
	if !bytes.Equal(digest, want[:]) {
		t.Errorf("digest: want sha256(canonical)=%x, got %x", want, digest)
	}
}

// TestFingerprintsMatch_SHA256ComparesDigest proves the sha256 branch accepts
// the digest of the identical canonical payload and rejects both a changed
// payload and a digest of different bytes.
func TestFingerprintsMatch_SHA256ComparesDigest(t *testing.T) {
	canonical := canonicalCreateBytes(t, map[string]any{"title": "Backend Go"})
	other := canonicalCreateBytes(t, map[string]any{"title": "Backend Rust"})
	stored := fingerprintDigest(canonical)

	tests := []struct {
		name    string
		stored  []byte
		payload []byte
		want    bool
	}{
		{"identical payload matches", stored, canonical, true},
		{"changed payload does not match", stored, other, false},
		{"digest of different bytes does not match", fingerprintDigest(other), canonical, false},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			match, err := fingerprintsMatch(FingerprintAlgorithmSHA256, tc.stored, tc.payload)
			if err != nil {
				t.Fatalf("fingerprintsMatch: unexpected error %v", err)
			}
			if match != tc.want {
				t.Errorf("match = %v, want %v", match, tc.want)
			}
		})
	}
}

// TestFingerprintsMatch_LegacyComparesCanonicalBytes proves a pre-00013 row
// (whose fingerprint column holds the raw canonical bytes) still replays and
// conflicts on byte equality, without ever hashing the stored value.
func TestFingerprintsMatch_LegacyComparesCanonicalBytes(t *testing.T) {
	canonical := canonicalCreateBytes(t, map[string]any{"title": "Backend Go"})
	other := canonicalCreateBytes(t, map[string]any{"title": "Backend Rust"})

	tests := []struct {
		name    string
		stored  []byte
		payload []byte
		want    bool
	}{
		{"identical canonical bytes match", canonical, canonical, true},
		{"changed canonical bytes do not match", canonical, other, false},
		{"sha256 digest under legacy tag does not match", fingerprintDigest(canonical), canonical, false},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			match, err := fingerprintsMatch(FingerprintAlgorithmLegacyCanonical, tc.stored, tc.payload)
			if err != nil {
				t.Fatalf("fingerprintsMatch: unexpected error %v", err)
			}
			if match != tc.want {
				t.Errorf("match = %v, want %v", match, tc.want)
			}
		})
	}
}

// TestFingerprintsMatch_FailsClosedOnUnknownAlgorithm proves a persisted
// algorithm this binary does not understand is an internal invariant failure,
// never a silent match or conflict.
func TestFingerprintsMatch_FailsClosedOnUnknownAlgorithm(t *testing.T) {
	canonical := canonicalCreateBytes(t, map[string]any{"title": "Backend Go"})

	match, err := fingerprintsMatch("go-json-v2+sha512", canonical, canonical)
	if match {
		t.Error("unknown algorithm must not report a match")
	}
	if !errors.Is(err, ErrUnknownFingerprintAlgorithm) {
		t.Errorf("unknown algorithm: want ErrUnknownFingerprintAlgorithm, got %v", err)
	}
}

// TestFingerprintsMatch_FailsClosedOnMalformedDigest proves a sha256-tagged row
// whose digest is not exactly 32 bytes is an internal invariant failure rather
// than a comparison against a truncated or empty slice.
func TestFingerprintsMatch_FailsClosedOnMalformedDigest(t *testing.T) {
	canonical := canonicalCreateBytes(t, map[string]any{"title": "Backend Go"})

	tests := []struct {
		name   string
		stored []byte
	}{
		{"empty digest", []byte{}},
		{"truncated digest", fingerprintDigest(canonical)[:31]},
		{"oversized digest", append(fingerprintDigest(canonical), 0x00)},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			match, err := fingerprintsMatch(FingerprintAlgorithmSHA256, tc.stored, canonical)
			if match {
				t.Error("malformed digest must not report a match")
			}
			if !errors.Is(err, ErrMalformedFingerprint) {
				t.Errorf("malformed digest: want ErrMalformedFingerprint, got %v", err)
			}
		})
	}
}
