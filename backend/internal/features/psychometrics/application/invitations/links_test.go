package invitations_test

import (
	"context"
	"crypto/sha256"
	"strings"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/psychometrics/application/invitations"
	"github.com/google/uuid"
)

type tokenFinder struct {
	calls int
	hash  [32]byte
	valid bool
	id    uuid.UUID
}

func (f *tokenFinder) FindAvailableToken(_ context.Context, hash [32]byte, valid bool) (uuid.UUID, error) {
	f.calls++
	f.hash = hash
	f.valid = valid
	return f.id, nil
}
func TestLookupTokenUnavailableIndistinguishable(t *testing.T) {
	for _, tc := range []struct{ name, raw string }{{"unknown", strings.Repeat("A", 43)}, {"revoked", strings.Repeat("B", 43)}, {"expired", strings.Repeat("C", 43)}, {"empty", ""}, {"short", "a"}, {"long", strings.Repeat("A", 44)}, {"alphabet", strings.Repeat("!", 43)}} {
		t.Run(tc.name, func(t *testing.T) {
			f := &tokenFinder{}
			id, err := invitations.LookupToken(context.Background(), f, tc.raw)
			if id != uuid.Nil || err != invitations.ErrUnavailable || err.Error() != "psychometric assessment unavailable" || f.calls != 1 || f.hash != sha256.Sum256([]byte(tc.raw)) {
				t.Fatal("distinguishable lookup outcome or path")
			}
		})
	}
	f := &tokenFinder{id: uuid.New()}
	raw := strings.Repeat("A", 43)
	id, err := invitations.LookupToken(context.Background(), f, raw)
	if err != nil || id != f.id || !f.valid || f.calls != 1 {
		t.Fatal("valid token failed")
	}
	// Even a finder that returns a row must not make malformed input available.
	f = &tokenFinder{id: uuid.New()}
	id, err = invitations.LookupToken(context.Background(), f, "bad")
	if id != uuid.Nil || err != invitations.ErrUnavailable || f.valid || f.calls != 1 {
		t.Fatal("malformed token accepted")
	}
}
