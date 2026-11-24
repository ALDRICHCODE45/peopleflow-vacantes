package usecases

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/entities"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/valueobjects"
	"github.com/google/uuid"
)

type fakeInvitationRepo struct {
	created []entities.StakeholderInvitation
}

func (f *fakeInvitationRepo) Create(_ context.Context, inv entities.StakeholderInvitation, _ []byte, _ int) error {
	f.created = append(f.created, inv)
	return nil
}

func (f *fakeInvitationRepo) ListPending(context.Context, uuid.UUID, time.Time) ([]entities.StakeholderInvitation, error) {
	return nil, nil
}

func (f *fakeInvitationRepo) Revoke(context.Context, uuid.UUID, uuid.UUID, uuid.UUID, time.Time) error {
	return nil
}

func (f *fakeInvitationRepo) Accept(context.Context, uuid.UUID, []byte, time.Time) (entities.StakeholderAcceptance, error) {
	return entities.StakeholderAcceptance{}, nil
}

func strPtr(s string) *string { return &s }

// Create stores the normalized note (audit gap D11) and returns it; blank or
// absent is nil.
func TestStakeholderInvitationCreateNormalizesNote(t *testing.T) {
	for _, tc := range []struct {
		raw  *string
		want *string
	}{
		{nil, nil},
		{strPtr("   "), nil},
		{strPtr("  José  "), strPtr("José")},
	} {
		repo := &fakeInvitationRepo{}
		svc := NewStakeholderInvitationService(repo, nil)
		issued, err := svc.Create(context.Background(), uuid.New(), uuid.New(), tc.raw)
		if err != nil {
			t.Fatal(err)
		}
		if len(repo.created) != 1 {
			t.Fatalf("created %d", len(repo.created))
		}
		for name, got := range map[string]*string{"stored": repo.created[0].Note, "returned": issued.Note} {
			switch {
			case got == nil && tc.want == nil:
			case got == nil || tc.want == nil || *got != *tc.want:
				t.Fatalf("%s note = %v, want %v", name, got, tc.want)
			}
		}
	}
}

// An invalid note is refused before the repository: nothing is stored.
func TestStakeholderInvitationCreateRejectsInvalidNote(t *testing.T) {
	repo := &fakeInvitationRepo{}
	svc := NewStakeholderInvitationService(repo, nil)
	for _, raw := range []string{strings.Repeat("a", 81), "a\nb", "a\x00b"} {
		if _, err := svc.Create(context.Background(), uuid.New(), uuid.New(), &raw); !errors.Is(err, valueobjects.ErrInvalidInvitationNote) {
			t.Fatalf("%q: err = %v", raw, err)
		}
	}
	if len(repo.created) != 0 {
		t.Fatalf("created %d invitations", len(repo.created))
	}
}
