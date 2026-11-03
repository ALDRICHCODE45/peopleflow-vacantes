package vacancyteam

import (
	"encoding/base64"
	"errors"
	"github.com/google/uuid"
	"testing"
	"time"
)

func TestPermissions(t *testing.T) {
	for _, tc := range []struct {
		name, mode, function string
		owner                bool
		count                int
		want                 Permissions
	}{
		{"responsible", "with_responsible", "responsible", false, 2, Permissions{AddMember: true, RemoveMember: true, EditDeadline: true, RenegotiateCommitment: true}},
		{"collaborator", "with_responsible", "collaborator", false, 2, Permissions{Leave: true, RenegotiateCommitment: true}},
		{"owner outside team", "with_responsible", "", true, 1, Permissions{AddMember: true, RemoveMember: true, ReassignResponsible: true, ChangeMode: true, EditDeadline: true, RenegotiateCommitment: true}},
		{"owner collaborator union", "with_responsible", "collaborator", true, 2, Permissions{AddMember: true, RemoveMember: true, Leave: true, ReassignResponsible: true, ChangeMode: true, EditDeadline: true, RenegotiateCommitment: true}},
		{"shared member", "shared", "member", false, 2, Permissions{AddMember: true, Leave: true, EditDeadline: true, RenegotiateCommitment: true}},
		{"last shared member", "shared", "member", false, 1, Permissions{AddMember: true, EditDeadline: true, RenegotiateCommitment: true}},
		{"shared owner member", "shared", "member", true, 2, Permissions{AddMember: true, RemoveMember: true, Leave: true, ChangeMode: true, EditDeadline: true, RenegotiateCommitment: true}},
		{"shared owner outside", "shared", "", true, 1, Permissions{AddMember: true, RemoveMember: true, ChangeMode: true, EditDeadline: true, RenegotiateCommitment: true}},
		{"nonmember", "shared", "", false, 2, Permissions{}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := Can(tc.mode, tc.function, tc.owner, tc.count); got != tc.want {
				t.Fatalf("got %+v want %+v", got, tc.want)
			}
		})
	}
}

func TestHistoryCursor(t *testing.T) {
	scope := Scope{CompanyID: uuid.New(), ActorID: uuid.New(), DraftID: uuid.New()}
	c := Cursor{Scope: scope, At: time.Date(2026, 11, 2, 18, 0, 0, 123456000, time.UTC), Kind: "tramo", ID: uuid.New()}
	token, err := EncodeCursor(c)
	if err != nil {
		t.Fatal(err)
	}
	got, err := DecodeCursor(token, scope)
	if err != nil || got != c {
		t.Fatal(got, err)
	}
	for _, token := range []string{"!", base64.RawURLEncoding.EncodeToString([]byte(`{}`)), base64.RawURLEncoding.EncodeToString([]byte(`{"version":1,"version":1}`))} {
		if _, err := DecodeCursor(token, scope); !errors.Is(err, ErrInvalidCursor) {
			t.Fatal(token, err)
		}
	}
	for _, other := range []Scope{{uuid.New(), scope.ActorID, scope.DraftID}, {scope.CompanyID, uuid.New(), scope.DraftID}, {scope.CompanyID, scope.ActorID, uuid.New()}} {
		if _, err := DecodeCursor(token, other); !errors.Is(err, ErrInvalidCursor) {
			t.Fatal("foreign cursor", err)
		}
	}
}

func TestETag(t *testing.T) {
	id := uuid.New()
	tag := ETag(id, 1)
	if len(tag) < 3 || tag[0] != '"' || tag[len(tag)-1] != '"' || tag == ETag(id, 2) || tag == ETag(uuid.New(), 1) || tag != ETag(id, 1) {
		t.Fatal(tag)
	}
}
