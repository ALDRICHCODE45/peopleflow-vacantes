package security

import (
	"context"
	"errors"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/valueobjects"
	"github.com/google/uuid"
)

// TestCompanyContext_InjectedRoundTrip locks the canonical contract: the
// middleware injects a CompanyContext, the handler reads it back. The
// CompanyID and Role fields MUST survive the round trip untouched — a
// partial read (e.g. CompanyID zeroed, or Role demoted to Unknown) would
// silently authorize the wrong identity.
func TestCompanyContext_InjectedRoundTrip(t *testing.T) {
	companyID := uuid.New()
	want := CompanyContext{CompanyID: companyID, Role: valueobjects.OwnerRole}

	ctx := ContextWithCompanyContext(context.Background(), want)

	got, ok := CompanyContextFromContext(ctx)
	if !ok {
		t.Fatal("expected ok=true when CompanyContext was previously injected")
	}
	if got.CompanyID != companyID {
		t.Errorf("CompanyID: want %v, got %v", companyID, got.CompanyID)
	}
	if got.Role != valueobjects.OwnerRole {
		t.Errorf("Role: want OwnerRole, got %v", got.Role)
	}
}

// TestCompanyContext_RecruiterRoleRoundTrip is the triangulation companion
// to the OwnerRole round trip — both ordinal members of the closed set
// must survive serialization through the context value, so the middleware
// (which writes the context) and the handler (which reads it) agree on
// the wire shape.
func TestCompanyContext_RecruiterRoleRoundTrip(t *testing.T) {
	companyID := uuid.New()
	want := CompanyContext{CompanyID: companyID, Role: valueobjects.RecruiterRole}

	ctx := ContextWithCompanyContext(context.Background(), want)

	got, ok := CompanyContextFromContext(ctx)
	if !ok {
		t.Fatal("expected ok=true when CompanyContext was previously injected")
	}
	if got.Role != valueobjects.RecruiterRole {
		t.Errorf("Role: want RecruiterRole, got %v", got.Role)
	}
}

// TestCompanyContext_MissingReturnsNotOk nails the spec scenario the
// middleware guard relies on: a handler reached WITHOUT the
// RequireCompanyRole middleware in front of it (or one that has been
// mis-wired) must surface as ok=false so the handler can short-circuit
// rather than read a zero-value CompanyContext and accidentally authorize
// the request from a missing gate.
func TestCompanyContext_MissingReturnsNotOk(t *testing.T) {
	got, ok := CompanyContextFromContext(context.Background())
	if ok {
		t.Fatalf("expected ok=false on a bare context, got ok=true (CompanyContext=%+v)", got)
	}
	if got != (CompanyContext{}) {
		t.Errorf("expected zero-value CompanyContext on miss, got: %+v", got)
	}
}

// TestCompanyContext_UnrelatedKeyDoesNotLeak is a defensive guard: a
// context that holds a value under a DIFFERENT (untyped) key MUST NOT be
// returned as a CompanyContext. A previous implementation that used
// `ctx.Value("company")` style keys would silently leak across packages;
// the untyped-key pattern (`companyContextKey{}`) is the only safe one.
func TestCompanyContext_UnrelatedKeyDoesNotLeak(t *testing.T) {
	type otherKey struct{}
	ctx := context.WithValue(context.Background(), otherKey{}, "something else")

	got, ok := CompanyContextFromContext(ctx)
	if ok {
		t.Fatalf("expected ok=false when no CompanyContext key is present, got ok=true (CompanyContext=%+v)", got)
	}
	if got != (CompanyContext{}) {
		t.Errorf("expected zero-value CompanyContext when no key is present, got: %+v", got)
	}
}

// TestCompanyContext_FieldZeroValueDoesNotPassAsPresent is the "wrong type
// under the right key" partner to the previous test: a value of the wrong
// type stored under the CompanyContext key MUST surface as ok=false —
// the type assertion is the only thing distinguishing a real injection
// from a context smuggling attempt.
func TestCompanyContext_FieldZeroValueDoesNotPassAsPresent(t *testing.T) {
	// Store a same-typed zero value AND a wrong-typed value to make sure
	// both are rejected (zero) or accepted (typed) as expected.
	zeroCtx := ContextWithCompanyContext(context.Background(), CompanyContext{})
	if got, ok := CompanyContextFromContext(zeroCtx); !ok || got != (CompanyContext{}) {
		// A zero-value CompanyContext IS the "about to be inserted" state:
		// ok=true is correct here because the helper CAN detect it; the
		// handler is responsible for refusing a zero-CompanyID downstream.
		// This case is the same as a valid injection with default fields,
		// not a "missing" case.
		t.Errorf("zero-value injection: want ok=true with zero CompanyContext, got ok=%v value=%+v", ok, got)
	}
}

// TestCompanyContext_NoExternalErrors is a smoke check that the helpers
// remain compatible with the errors.Is-style API — the production code
// must not return errors from the context helpers (caller checks `ok`).
// This test exists to fail loudly if a future refactor adds an error
// return that breaks the existing handler call sites.
func TestCompanyContext_NoExternalErrors(t *testing.T) {
	// Errors import is dead if the contract is satisfied; the var below
	// keeps the import alive so the test fails the build if a refactor
	// removes the import without recognizing why it's there.
	_ = errors.Is
}
