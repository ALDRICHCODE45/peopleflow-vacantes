// Package v2 owns organic vacancy participations, distinct from legacy applications.
// Screening and pipeline rules enter through explicit composition-root ports.
package v2

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"sort"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/shared/httpjson"
	"github.com/google/uuid"
)

var (
	ErrInvalidRequest       = errors.New("invalid application request")
	ErrNotFound             = errors.New("vacancy not found")
	ErrQuestionnaireChanged = errors.New("questionnaire changed")
	ErrAlreadyApplied       = errors.New("already applied")
	ErrCVUnavailable        = errors.New("CV unavailable")
	ErrIdempotencyConflict  = errors.New("idempotency conflict")
)

type InvalidAnswers struct{ Details []httpjson.AnswerDetail }

func (e *InvalidAnswers) Error() string { return "invalid answers" }

type Answer struct {
	QuestionID string `json:"question_id"`
	OptionID   string `json:"option_id,omitempty"`
	Text       string `json:"text,omitempty"`
	// Presence/type markers distinguish empty/missing/wrong-type answers.
	HasOption bool `json:"-"`
	HasText   bool `json:"-"`
	WrongType bool `json:"-"`
}
type Request struct {
	CVID     uuid.UUID `json:"cv_id"`
	Revision string    `json:"questionnaire_revision"`
	Answers  []Answer  `json:"answers"`
}
type Submitted struct {
	ID        uuid.UUID `json:"id"`
	VacancyID uuid.UUID `json:"vacancy_id"`
	Status    string    `json:"status"`
	AppliedAt time.Time `json:"applied_at"`
}
type Result struct {
	Body     []byte
	Replayed bool
}
type Vacancy struct {
	State string    `json:"state"`
	ID    uuid.UUID `json:"id"`
	Title string    `json:"title"`
}
type Item struct {
	ID        uuid.UUID `json:"id"`
	Vacancy   Vacancy   `json:"vacancy"`
	Company   Company   `json:"company"`
	AppliedAt time.Time `json:"applied_at"`
	UpdatedAt time.Time `json:"updated_at"`
	Status    string    `json:"status"`
	Message   *string   `json:"message"`
}
type Page struct {
	Items      []Item  `json:"items"`
	NextCursor *string `json:"next_cursor"`
}
type Position struct {
	ID uuid.UUID `json:"id"`
	At time.Time `json:"at"`
}
type Query struct {
	Limit int
	After *Position
}
type Store interface {
	Apply(context.Context, string, uuid.UUID, uuid.UUID, Request) (Result, error)
	List(context.Context, string, Query) (Page, error)
}

// JSONDecoder is injected by the composition root so strict JSON decoding
// can be reused without a cross-feature package dependency.
type JSONDecoder func([]byte) (any, error)

func Decode(body []byte, decode JSONDecoder) (Request, error) {
	value, err := decode(body)
	if err != nil {
		return Request{}, ErrInvalidRequest
	}
	root, ok := value.(map[string]any)
	if !ok || len(root) != 3 {
		return Request{}, ErrInvalidRequest
	}
	cv, ok := root["cv_id"].(string)
	if !ok {
		return Request{}, ErrInvalidRequest
	}
	id, err := uuid.Parse(cv)
	if err != nil || id == uuid.Nil {
		return Request{}, ErrInvalidRequest
	}
	revision, ok := root["questionnaire_revision"].(string)
	if !ok || revision == "" {
		return Request{}, ErrInvalidRequest
	}
	items, ok := root["answers"].([]any)
	if !ok {
		return Request{}, ErrInvalidRequest
	}
	req := Request{CVID: id, Revision: revision, Answers: make([]Answer, 0, len(items))}
	for _, raw := range items {
		obj, ok := raw.(map[string]any)
		if !ok {
			return Request{}, ErrInvalidRequest
		}
		for key := range obj {
			if key != "question_id" && key != "option_id" && key != "text" {
				return Request{}, ErrInvalidRequest
			}
		}
		q, ok := obj["question_id"].(string)
		if !ok {
			return Request{}, ErrInvalidRequest
		}
		qid, err := uuid.Parse(q)
		if err != nil {
			return Request{}, ErrInvalidRequest
		}
		a := Answer{QuestionID: qid.String()}
		if v, present := obj["text"]; present {
			a.HasText = true
			a.Text, ok = v.(string)
			a.WrongType = !ok
			a.Text = strings.TrimSpace(a.Text)
		}
		if v, present := obj["option_id"]; present {
			a.HasOption = true
			a.OptionID, ok = v.(string)
			a.WrongType = a.WrongType || !ok
		}
		req.Answers = append(req.Answers, a)
	}
	return req, nil
}
func ValidateAnswers(form Screening, answers []Answer) error {
	known := map[string]Question{}
	for _, q := range form.Questions {
		known[strings.ToLower(q.ID)] = q
	}
	byID := map[string]Answer{}
	for _, a := range answers {
		key := strings.ToLower(a.QuestionID)
		if _, ok := known[key]; !ok {
			return ErrInvalidRequest
		}
		if _, ok := byID[key]; ok {
			return ErrInvalidRequest
		}
		byID[key] = a
	}
	details := []httpjson.AnswerDetail{}
	for _, q := range form.Questions {
		a, present := byID[strings.ToLower(q.ID)]
		reason := ""
		switch {
		case !present || (!a.HasText && !a.HasOption):
			reason = "required"
		case a.WrongType:
			reason = "wrong_type"
		case q.Type == "open":
			if a.HasOption || !a.HasText {
				reason = "wrong_type"
			} else if a.Text == "" {
				reason = "required"
			} else if !utf8.ValidString(a.Text) {
				reason = "wrong_type"
			} else if utf8.RuneCountInString(a.Text) > 2000 {
				reason = "too_long"
			}
		case q.Type == "single_choice":
			if a.HasText || !a.HasOption {
				reason = "wrong_type"
			} else {
				reason = "unknown_option"
				for _, o := range q.Options {
					if a.OptionID == o.ID {
						reason = ""
						break
					}
				}
			}
		default:
			return errors.New("unsupported screening type")
		}
		if reason != "" {
			details = append(details, httpjson.AnswerDetail{QuestionID: q.ID, Reason: reason})
		}
	}
	if len(details) > 0 {
		return &InvalidAnswers{details}
	}
	return nil
}

// Fingerprint includes the normalized request with answers sorted by identity;
// answer ordering and surrounding open-text whitespace are not payload changes.
func Fingerprint(req Request) ([]byte, error) {
	req.Answers = append([]Answer{}, req.Answers...)
	sort.Slice(req.Answers, func(i, j int) bool { return req.Answers[i].QuestionID < req.Answers[j].QuestionID })
	shape := make([][3]bool, len(req.Answers))
	for i, a := range req.Answers {
		shape[i] = [3]bool{a.HasText, a.HasOption, a.WrongType}
	}
	raw, err := json.Marshal(struct {
		Request Request
		Shape   [][3]bool
	}{req, shape})
	if err != nil {
		return nil, err
	}
	sum := sha256.Sum256(raw)
	return sum[:], nil
}
