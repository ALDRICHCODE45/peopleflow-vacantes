package security

import (
	"context"
	"errors"
	"testing"
)

// fakeVerifier is a hand-rolled stub used only to lock the port signature down.
type fakeVerifier struct {
	claims Claims
	err    error
}

func (f *fakeVerifier) Verify(_ context.Context, _ string) (Claims, error) {
	if f.err != nil {
		return Claims{}, f.err
	}
	return f.claims, nil
}

// Compile-time assertion that the fake implements the port.
var _ Verifier = (*fakeVerifier)(nil)

// TestVerifier_PortShape pins the API: Verify(ctx, token) (Claims, error).
func TestVerifier_PortShape(t *testing.T) {
	v := &fakeVerifier{claims: Claims{Subject: "sub-123", Groups: []string{"candidates"}}}
	c, err := v.Verify(context.Background(), "header.payload.signature")
	if err != nil {
		t.Fatalf("expected no error, got: %v", err)
	}
	if c.Subject != "sub-123" {
		t.Errorf("Subject: want sub-123, got %q", c.Subject)
	}
	if len(c.Groups) != 1 || c.Groups[0] != "candidates" {
		t.Errorf("Groups: want [candidates], got %v", c.Groups)
	}
}

// TestVerifier_PropagatesError locks the contract that an invalid token
// surfaces as a non-nil error.
func TestVerifier_PropagatesError(t *testing.T) {
	want := errors.New("invalid token")
	v := &fakeVerifier{err: want}
	_, err := v.Verify(context.Background(), "nope")
	if err == nil || err.Error() != "invalid token" {
		t.Errorf("expected error %v, got: %v", want, err)
	}
}

// TestClaims_FieldsExist is a compile-time-only check that Claims exposes the
// Subject and Groups fields the middleware places into request context.
func TestClaims_FieldsExist(t *testing.T) {
	c := Claims{Subject: "abc", Groups: []string{"recruiters", "company_admins"}}
	if c.Subject != "abc" {
		t.Errorf("Subject field missing: %v", c)
	}
	if len(c.Groups) != 2 {
		t.Errorf("Groups field missing: %v", c)
	}
}
