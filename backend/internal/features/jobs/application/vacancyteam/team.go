// Package vacancyteam defines the vacancy team read port and its pure rules.
package vacancyteam

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"strconv"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/draftjson"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/drafts"
	"github.com/google/uuid"
)

type Store interface {
	GetTeam(context.Context, uuid.UUID, uuid.UUID, uuid.UUID) (drafts.Result, error)
	GetTeamHistory(context.Context, uuid.UUID, uuid.UUID, uuid.UUID, string) (drafts.Result, error)
}

// AssignmentHistoryStore reads the caller's continuous stays across their current company.
type AssignmentHistoryStore interface {
	GetAssignmentHistory(context.Context, uuid.UUID, uuid.UUID, string) (drafts.Result, error)
}

type Permissions struct {
	AddMember             bool `json:"add_member"`
	RemoveMember          bool `json:"remove_member"`
	Leave                 bool `json:"leave"`
	ReassignResponsible   bool `json:"reassign_responsible"`
	ChangeMode            bool `json:"change_mode"`
	EditDeadline          bool `json:"edit_deadline"`
	RenegotiateCommitment bool `json:"renegotiate_commitment"`
}

func Can(mode, function string, owner bool, members int) Permissions {
	active := function != ""
	manage := owner || (mode == "with_responsible" && function == "responsible") || (mode == "shared" && active)
	return Permissions{
		AddMember: manage, RemoveMember: owner || (mode == "with_responsible" && function == "responsible"),
		Leave:               (mode == "with_responsible" && function == "collaborator") || (mode == "shared" && active && members > 1),
		ReassignResponsible: owner && mode == "with_responsible", ChangeMode: owner,
		EditDeadline: manage, RenegotiateCommitment: owner || active,
	}
}

func ETag(id uuid.UUID, version int64) string {
	digest := sha256.Sum256([]byte("vacancy-team:r1:" + id.String() + ":" + strconv.FormatInt(version, 10)))
	return `"vt1-` + base64.RawURLEncoding.EncodeToString(digest[:]) + `"`
}

var ErrInvalidCursor = errors.New("vacancyteam: invalid cursor")

type Scope struct{ CompanyID, ActorID, DraftID uuid.UUID }
type Cursor struct {
	Scope
	At   time.Time
	Kind string
	ID   uuid.UUID
}
type cursorWire struct {
	Version   int       `json:"version"`
	CompanyID uuid.UUID `json:"company_id"`
	ActorID   uuid.UUID `json:"actor_id"`
	DraftID   uuid.UUID `json:"draft_id"`
	At        time.Time `json:"at"`
	Kind      string    `json:"kind"`
	ID        uuid.UUID `json:"id"`
}

func EncodeCursor(c Cursor) (string, error) {
	raw, err := json.Marshal(cursorWire{1, c.CompanyID, c.ActorID, c.DraftID, c.At.UTC().Truncate(time.Microsecond), c.Kind, c.ID})
	if err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(raw), nil
}
func DecodeCursor(token string, scope Scope) (Cursor, error) {
	if len(token) == 0 || len(token) > 4096 {
		return Cursor{}, ErrInvalidCursor
	}
	raw, err := base64.RawURLEncoding.Strict().DecodeString(token)
	if err != nil {
		return Cursor{}, ErrInvalidCursor
	}
	value, err := draftjson.Decode(raw)
	if err != nil {
		return Cursor{}, ErrInvalidCursor
	}
	object, ok := value.(map[string]any)
	if !ok || len(object) != 7 {
		return Cursor{}, ErrInvalidCursor
	}
	var w cursorWire
	if err := json.Unmarshal(raw, &w); err != nil || w.Version != 1 || w.CompanyID != scope.CompanyID || w.ActorID != scope.ActorID || w.DraftID != scope.DraftID || w.ID == uuid.Nil || w.At.IsZero() || (w.Kind != "tramo" && w.Kind != "reassignment" && w.Kind != "mode_change") {
		return Cursor{}, ErrInvalidCursor
	}
	c := Cursor{scope, w.At, w.Kind, w.ID}
	canonical, err := EncodeCursor(c)
	if err != nil || canonical != token {
		return Cursor{}, ErrInvalidCursor
	}
	return c, nil
}
