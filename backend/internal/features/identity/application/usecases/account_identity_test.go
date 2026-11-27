package usecases_test

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/application/usecases"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/entities"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/valueobjects"
)

// fakeAccounts is an in-memory AccountStore. winner simulates a concurrent
// same-subject insert that committed first: CreateAccount returns it with
// created=false instead of inserting.
type fakeAccounts struct {
	live      *entities.User
	winner    *entities.User
	createErr error
	lookupErr error
	lookups   int
	creates   []*entities.User
}

func (s *fakeAccounts) GetByCognitoSub(_ context.Context, sub string) (*entities.User, error) {
	s.lookups++
	if s.lookupErr != nil {
		return nil, s.lookupErr
	}
	if s.live == nil || s.live.CognitoSub != sub {
		return nil, entities.ErrUserNotFound
	}
	return s.live, nil
}

func (s *fakeAccounts) CreateAccount(_ context.Context, u *entities.User) (*entities.User, bool, error) {
	s.creates = append(s.creates, u)
	if s.createErr != nil {
		return nil, false, s.createErr
	}
	if s.winner != nil {
		return s.winner, false, nil
	}
	s.live = u
	return u, true, nil
}

type fakeProvider struct {
	identity usecases.VerifiedIdentity
	err      error
	tokens   []string
}

func (p *fakeProvider) Fetch(_ context.Context, token string) (usecases.VerifiedIdentity, error) {
	p.tokens = append(p.tokens, token)
	return p.identity, p.err
}

func account(t *testing.T, sub string, role valueobjects.UserType) *entities.User {
	t.Helper()
	email, _ := valueobjects.NewEmail("existing@example.com")
	name, _ := valueobjects.NewFullName("Original Name")
	u, err := entities.NewUser(sub, email, name, role)
	if err != nil {
		t.Fatal(err)
	}
	return u
}

var verified = usecases.VerifiedIdentity{Subject: "subject", Email: "Laura@Empresa.MX", EmailVerified: true}

type onboardFn func(*usecases.CandidateIdentity, context.Context, string, string, string) (*entities.User, bool, error)

var onboardings = map[valueobjects.UserType]onboardFn{
	valueobjects.UserCandidate: (*usecases.CandidateIdentity).Onboard,
	valueobjects.UserRecruiter: (*usecases.CandidateIdentity).OnboardEmployer,
}

func otherRole(role valueobjects.UserType) valueobjects.UserType {
	if role == valueobjects.UserCandidate {
		return valueobjects.UserRecruiter
	}
	return valueobjects.UserCandidate
}

// embedded-auth-v1 D1–D2 (order of checks): both onboardings run the same
// flow; only the target role and the "other role" side differ.
func TestAccountOnboardingOrderOfChecks(t *testing.T) {
	dbDown := errors.New("db down")
	for role, onboard := range onboardings {
		t.Run(role.String(), func(t *testing.T) {
			cases := []struct {
				name           string
				rawName        string
				live, winner   valueobjects.UserType
				provider       *fakeProvider
				noProvider     bool
				lookupErr      error
				createErr      error
				wantErr        error
				wantCreated    bool
				wantProvider   int
				wantCreates    int
				wantLiveResult bool
			}{
				{name: "invalid name before anything", rawName: " x ", provider: &fakeProvider{identity: verified}, wantErr: usecases.ErrInvalidAccountName},
				{name: "too long name", rawName: strings.Repeat("界", 121), provider: &fakeProvider{identity: verified}, wantErr: usecases.ErrInvalidAccountName},
				{name: "lookup failure", rawName: "Laura", lookupErr: dbDown, provider: &fakeProvider{identity: verified}, wantErr: dbDown},
				{name: "same role retry without provider", rawName: "Other Name", live: role, provider: &fakeProvider{identity: verified}, wantLiveResult: true},
				{name: "other role exists", rawName: "Laura", live: otherRole(role), provider: &fakeProvider{identity: verified}, wantErr: usecases.ErrAccountExists},
				{name: "no provider", rawName: "Laura", noProvider: true, wantErr: usecases.ErrIdentityUnavailable},
				{name: "provider failure", rawName: "Laura", provider: &fakeProvider{err: errors.New("boom")}, wantErr: usecases.ErrIdentityUnavailable, wantProvider: 1},
				{name: "subject mismatch", rawName: "Laura", provider: &fakeProvider{identity: usecases.VerifiedIdentity{Subject: "other", Email: "a@example.com", EmailVerified: true}}, wantErr: usecases.ErrEmailNotVerified, wantProvider: 1},
				{name: "unverified", rawName: "Laura", provider: &fakeProvider{identity: usecases.VerifiedIdentity{Subject: "subject", Email: "a@example.com"}}, wantErr: usecases.ErrEmailNotVerified, wantProvider: 1},
				{name: "invalid provider email", rawName: "Laura", provider: &fakeProvider{identity: usecases.VerifiedIdentity{Subject: "subject", Email: "invalid", EmailVerified: true}}, wantErr: usecases.ErrIdentityUnavailable, wantProvider: 1},
				{name: "email taken", rawName: "Laura", provider: &fakeProvider{identity: verified}, createErr: entities.ErrEmailTaken, wantErr: entities.ErrEmailTaken, wantProvider: 1, wantCreates: 1},
				{name: "concurrent same-role winner", rawName: "Laura", winner: role, provider: &fakeProvider{identity: verified}, wantProvider: 1, wantCreates: 1},
				{name: "concurrent other-role winner", rawName: "Laura", winner: otherRole(role), provider: &fakeProvider{identity: verified}, wantErr: usecases.ErrAccountExists, wantProvider: 1, wantCreates: 1},
				{name: "create", rawName: "  Laura Gómez  ", provider: &fakeProvider{identity: verified}, wantCreated: true, wantProvider: 1, wantCreates: 1},
			}
			for _, tc := range cases {
				t.Run(tc.name, func(t *testing.T) {
					store := &fakeAccounts{lookupErr: tc.lookupErr, createErr: tc.createErr}
					if tc.live != valueobjects.UnknownUserType {
						store.live = account(t, "subject", tc.live)
					}
					if tc.winner != valueobjects.UnknownUserType {
						store.winner = account(t, "subject", tc.winner)
					}
					live := store.live
					var provider usecases.UserInfoProvider
					if !tc.noProvider {
						provider = tc.provider
					}
					svc := usecases.NewCandidateIdentity(store, provider)
					u, created, err := onboard(svc, context.Background(), "subject", "caller-token", tc.rawName)
					if !errors.Is(err, tc.wantErr) || (tc.wantErr == nil) != (err == nil) {
						t.Fatalf("err = %v, want %v", err, tc.wantErr)
					}
					if created != tc.wantCreated {
						t.Fatalf("created = %v", created)
					}
					if tc.provider != nil && len(tc.provider.tokens) != tc.wantProvider {
						t.Fatalf("provider calls = %d, want %d", len(tc.provider.tokens), tc.wantProvider)
					}
					if tc.provider != nil && tc.wantProvider == 1 && tc.provider.tokens[0] != "caller-token" {
						t.Fatal("caller token not forwarded")
					}
					if len(store.creates) != tc.wantCreates {
						t.Fatalf("creates = %d, want %d", len(store.creates), tc.wantCreates)
					}
					if tc.wantErr != nil && u != nil {
						t.Fatal("user returned with error")
					}
					if tc.wantLiveResult && u != live {
						t.Fatal("retry did not return the live account unchanged")
					}
					if tc.winner == role && u != store.winner {
						t.Fatal("concurrent winner not returned")
					}
					if tc.wantCreates == 1 {
						c := store.creates[0]
						if c.UserType != role || c.CognitoSub != "subject" || c.Email.Value() != "laura@empresa.mx" {
							t.Fatalf("wrong insert: %s %s %s", c.UserType, c.CognitoSub, c.Email.Value())
						}
						if tc.wantCreated && (c.FullName.Value() != "Laura Gómez" || u != c) {
							t.Fatal("name not trimmed or created user not returned")
						}
					}
				})
			}
		})
	}
}
