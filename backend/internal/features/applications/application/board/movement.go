// Package board owns recruiter participation views and stage movement rules.
package board

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"strconv"
	"strings"
	"time"

	intake "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/application/v2"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

var (
	ErrNotFound             = errors.New("participation not found")
	ErrTeamAccessEnded      = errors.New("team access ended")
	ErrInvalidRequest       = errors.New("invalid movement request")
	ErrValidation           = errors.New("invalid stage movement")
	ErrPreconditionRequired = errors.New("participation precondition required")
	ErrVersionConflict      = errors.New("participation version conflict")
	ErrVersionOverflow      = errors.New("participation version overflow")
	ErrUnauthenticated      = errors.New("unauthenticated")
	ErrForbidden            = errors.New("forbidden")
	ErrCompanyInactive      = errors.New("company inactive")
	ErrCompanyNotActive     = errors.New("company not active")
	ErrStageSkip            = errors.New("stage skip not allowed")
	ErrPlacementExit        = errors.New("placement exit reason required")
	ErrNotPublished         = errors.New("vacancy not published")
	ErrTooLarge             = errors.New("board too large")
	ErrStorageUnavailable   = errors.New("CV storage unavailable")
)

type Stage struct {
	ID    string `json:"id"`
	Kind  string `json:"kind"`
	Name  string `json:"name"`
	Count int    `json:"count"`
}
type RetiredStage struct {
	ID       string `json:"id"`
	Kind     string `json:"kind"`
	Name     string `json:"name"`
	Position int    `json:"-"`
}

// ProcessFinished carries the jobs-owned view without importing that feature.
type ProcessFinished struct {
	Lifecycle json.RawMessage `json:"lifecycle"`
}

func (e *ProcessFinished) Error() string { return "process finished" }

type Pipeline struct {
	Retired  []RetiredStage
	Stages   []Stage
	Exit     Stage
	Required *int64
}

// VacancyContext holds the authoring row lock until the surrounding transaction
// ends, sharing the same authorization and configuration rules as draft saves.
type VacancyContext interface {
	Lifecycle(context.Context, pgx.Tx, uuid.UUID) (json.RawMessage, error)
	Screening([]byte) (intake.Screening, error)
	DeliverySummary(context.Context, pgx.Tx, uuid.UUID) (string, int64, int64, error)
	RecordDelivery(context.Context, pgx.Tx, uuid.UUID, uuid.UUID, uuid.UUID, time.Time) error
	Load(context.Context, pgx.Tx, uuid.UUID, uuid.UUID, uuid.UUID) (Pipeline, error)
}
type Person struct {
	ID       uuid.UUID `json:"id"`
	FullName string    `json:"full_name"`
}
type Candidate struct {
	ID       uuid.UUID `json:"id"`
	FullName string    `json:"full_name"`
	Kind     string    `json:"kind"`
}
type AddedBy struct {
	ID   uuid.UUID `json:"id"`
	Name string    `json:"name"`
}
type CV struct {
	ID     uuid.UUID `json:"id"`
	Name   string    `json:"name"`
	Source string    `json:"source"`
}

type CVMetadata struct {
	FileName   string    `json:"file_name"`
	UploadedAt time.Time `json:"uploaded_at"`
}
type Substate struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type Item struct {
	CorrectedFields  []string          `json:"corrected_fields"`
	Profile          Profile           `json:"profile"`
	ScreeningAnswers []ScreeningAnswer `json:"screening_answers"`
	SubstateID       *string           `json:"substate_id"`
	ID               uuid.UUID         `json:"id"`
	StageID          string            `json:"stage_id"`
	Version          string            `json:"version"`
	ETag             string            `json:"etag"`
	Candidate        Candidate         `json:"candidate"`
	AddedBy          *AddedBy          `json:"added_by"`
	AppliedAt        time.Time         `json:"applied_at"`
	Source           string            `json:"source"`
	CV               CV                `json:"cv"`
	MovedAt          time.Time         `json:"moved_at"`
	Discard          *Discard          `json:"discard"`
}
type Coverage struct {
	Covered               int64      `json:"covered"`
	Required              *int64     `json:"required"`
	FullCoverageReachedAt *time.Time `json:"full_coverage_reached_at"`
}
type Delivery struct {
	State     string `json:"state"`
	Delivered int64  `json:"delivered"`
	Target    int64  `json:"target"`
}
type Board struct {
	Lifecycle        json.RawMessage   `json:"lifecycle"`
	ScreeningFilters []ScreeningFilter `json:"screening_filters"`
	RetiredStages    []RetiredStage    `json:"retired_stages"`
	Delivery         Delivery          `json:"delivery"`
	Substates        []Substate        `json:"substates"`
	Stages           []Stage           `json:"stages"`
	Exit             Stage             `json:"exit"`
	Coverage         Coverage          `json:"coverage"`
	Participations   []Item            `json:"participations"`
}
type Move struct {
	ToStageID           string
	PlacementExitReason string
}
type Moved struct {
	Delivery Delivery `json:"delivery"`
	Item
	Coverage Coverage `json:"coverage"`
}
type Actor struct {
	Kind string `json:"kind"`
	Person
}
type Entry struct {
	FromSubstateID   *string   `json:"from_substate_id"`
	FromSubstateName *string   `json:"from_substate_name"`
	ToSubstateID     *string   `json:"to_substate_id"`
	ToSubstateName   *string   `json:"to_substate_name"`
	Kind             string    `json:"kind"`
	FromStageID      *string   `json:"from_stage_id"`
	ToStageID        string    `json:"to_stage_id"`
	Hire             bool      `json:"hire"`
	Departure        bool      `json:"departure"`
	Actor            Actor     `json:"actor"`
	At               time.Time `json:"at"`
	Reason           *Reason   `json:"-"`
	Comment          *string   `json:"-"`
	CandidateMessage *string   `json:"-"`
}
type History struct {
	Items []Entry `json:"items"`
}
type Answer struct {
	OptionID string  `json:"option_id,omitempty"`
	Label    string  `json:"label,omitempty"`
	Text     *string `json:"text,omitempty"`
}
type Screening struct {
	QuestionID string `json:"question_id"`
	Prompt     string `json:"prompt"`
	Type       string `json:"type"`
	Answer     Answer `json:"answer"`
}
type Detail struct {
	Item
	Screening        []Screening     `json:"screening"`
	Comment          *string         `json:"comment"`
	CandidateMessage *string         `json:"candidate_message"`
	Contact          Contact         `json:"contact"`
	Original         json.RawMessage `json:"original"`
	OriginalCV       *CVMetadata     `json:"original_cv"`
}

// Contact is every available way to reach the candidate, shown only on the
// participation detail: the company record for manual candidates, the account
// email and profile phone with company corrections for organic ones (including reuse).
type Contact struct {
	Email *string `json:"email"`
	Phone *string `json:"phone"`
}
type File struct {
	// CompanyCorrected is internal download provenance, never a public filename or key.
	CompanyCorrected  bool
	Name, ContentType string
	Size              int64
	Reader            io.ReadCloser
}
type Store interface {
	SetSubstate(context.Context, uuid.UUID, uuid.UUID, uuid.UUID, uuid.UUID, string, bool, []byte) (Moved, error)
	Board(context.Context, uuid.UUID, uuid.UUID, uuid.UUID) (Board, error)
	Move(context.Context, uuid.UUID, uuid.UUID, uuid.UUID, uuid.UUID, string, bool, []byte) (Moved, error)
	Discard(context.Context, uuid.UUID, uuid.UUID, uuid.UUID, uuid.UUID, string, bool, []byte) (Moved, error)
	Recover(context.Context, uuid.UUID, uuid.UUID, uuid.UUID, uuid.UUID, string, bool, []byte) (Moved, error)
	History(context.Context, uuid.UUID, uuid.UUID, uuid.UUID, uuid.UUID) (History, error)
	Detail(context.Context, uuid.UUID, uuid.UUID, uuid.UUID, uuid.UUID) (Detail, error)
	File(context.Context, uuid.UUID, uuid.UUID, uuid.UUID, uuid.UUID) (File, error)
}

// OriginalFileReader is separate so existing read-only adapters remain usable.
type OriginalFileReader interface {
	OriginalFile(context.Context, uuid.UUID, uuid.UUID, uuid.UUID, uuid.UUID) (File, error)
}
type JSONDecoder func([]byte) (any, error)

func DecodeMove(body []byte, decode JSONDecoder) (Move, error) {
	value, err := decode(body)
	if err != nil {
		return Move{}, ErrInvalidRequest
	}
	root, ok := value.(map[string]any)
	if !ok {
		return Move{}, ErrInvalidRequest
	}
	for k := range root {
		if k != "to_stage_id" && k != "placement_exit_reason" {
			return Move{}, ErrInvalidRequest
		}
	}
	target, ok := root["to_stage_id"].(string)
	if !ok {
		return Move{}, ErrInvalidRequest
	}
	id, err := uuid.Parse(target)
	if err != nil || id == uuid.Nil {
		return Move{}, ErrInvalidRequest
	}
	m := Move{ToStageID: id.String()}
	m.PlacementExitReason, err = decodePlacementExitReason(root)
	if err != nil {
		return Move{}, err
	}
	return m, nil
}
func ValidateMove(stages []Stage, from string, m Move) (hire, departure bool, err error) {
	current, target := -1, -1
	for i, s := range stages {
		if s.ID == from {
			current = i
		}
		if s.ID == m.ToStageID {
			target = i
		}
	}
	if current >= 0 && (stages[current].Kind != "placement" || current == target) && m.PlacementExitReason != "" {
		return false, false, ErrInvalidRequest
	}
	if current < 0 || target < 0 || current == target {
		return false, false, ErrValidation
	}
	if target > current+1 {
		return false, false, ErrStageSkip
	}
	if err := ValidatePlacementExit(stages[current].Kind == "placement", m.PlacementExitReason); err != nil {
		return false, false, err
	}
	return stages[target].Kind == "placement", stages[current].Kind == "placement", nil
}

// ValidatePlacementExit is shared by moves and discard. The decoded reason
// reaches the store request for T4 credit handling, but is not persisted in T3.
func ValidatePlacementExit(leaving bool, reason string) error {
	if leaving && reason == "" {
		return ErrPlacementExit
	}
	if !leaving && reason != "" {
		return ErrInvalidRequest
	}
	if reason != "" && reason != "moved_by_mistake" && reason != "candidate_left" {
		return ErrInvalidRequest
	}
	return nil
}
func decodePlacementExitReason(root map[string]any) (string, error) {
	raw, present := root["placement_exit_reason"]
	if !present {
		return "", nil
	}
	reason, ok := raw.(string)
	if !ok || reason != "moved_by_mistake" && reason != "candidate_left" {
		return "", ErrInvalidRequest
	}
	return reason, nil
}
func ETag(id uuid.UUID, version int64) string {
	digest := sha256.Sum256([]byte("process-participation:r1:" + id.String() + ":" + strconv.FormatInt(version, 10)))
	return `"pm1-` + base64.RawURLEncoding.EncodeToString(digest[:]) + `"`
}
func CheckIfMatch(issued, value string, present bool) error {
	if !present {
		return ErrPreconditionRequired
	}
	raw := strings.Trim(value, " \t")
	if len(raw) < 3 || raw[0] != '"' || raw[len(raw)-1] != '"' {
		return ErrInvalidRequest
	}
	for i := 1; i < len(raw)-1; i++ {
		if raw[i] < 0x21 || raw[i] == '"' || raw[i] == 0x7f || raw[i] == ',' {
			return ErrInvalidRequest
		}
	}
	if raw != issued {
		return ErrVersionConflict
	}
	return nil
}
