package draftinput

import (
	"bytes"
	"encoding/json"
	"errors"
	"reflect"
	"strings"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/draftfields"
)

func TestDecodePatchV2Presence(t *testing.T) {
	for _, tc := range []struct{ name, body, golden string }{
		{"scalar", `{"fields":{"title":" X "}}`, `{"fields":{"title":"X"},"schema_version":2}`},
		{"null", `{"fields":{"title":null,"requester":null,"description":null}}`, `{"fields":{"description":null,"requester":null,"title":null},"schema_version":2}`},
		{"empty screening replacement", `{"fields":{"screening_questions":[]}}`, `{"fields":{"screening_questions":[]},"schema_version":2}`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			body := []byte(tc.body)
			before := bytes.Clone(body)
			p, err := DecodePatchV2(body)
			if err != nil {
				t.Fatal(err)
			}
			if string(p.Fingerprint()) != tc.golden {
				t.Fatalf("fingerprint %s", p.Fingerprint())
			}
			if p.Location.Set || p.Compensation.Set || p.ScreeningQuestions.Set {
				t.Fatal("defaults or legacy screening leaked")
			}
			supplied := strings.Contains(tc.body, "screening_questions")
			if p.ScreeningQuestionsV2.Set != supplied || p.ScreeningQuestionsV2.Valid != supplied {
				t.Fatal("screening presence")
			}
			if supplied && p.ScreeningQuestionsV2.Value == nil {
				t.Fatal("empty screening must be nonnil")
			}
			if !bytes.Equal(body, before) {
				t.Fatal("input mutated")
			}
			fingerprint := p.Fingerprint()
			fingerprint[0] = '!'
			if string(p.Fingerprint()) != tc.golden {
				t.Fatal("fingerprint aliases")
			}
		})
	}
}

func TestDecodePatchV2Errors(t *testing.T) {
	for _, tc := range []struct {
		name, body       string
		want, underlying error
	}{
		{"empty", `{"fields":{}}`, ErrEmptyPatch, nil},
		{"client marker", `{"fields":{},"schema_version":2}`, ErrInvalidRequest, nil},
		{"wrong root", `[]`, ErrInvalidRequest, nil},
		{"wrong fields", `{"fields":null}`, ErrInvalidRequest, nil},
		{"duplicate", `{"fields":{"title":"a","title":"b"}}`, ErrInvalidRequest, nil},
		{"trailing", `{"fields":{}} {}`, ErrInvalidRequest, nil},
		{"fraction", `{"fields":{"title":1.5}}`, ErrInvalidRequest, nil},
		{"surrogate", `{"fields":{"title":"\ud800"}}`, ErrInvalidRequest, nil},
		{"readonly", `{"fields":{"requester":{"name":"x"}}}`, ErrInvalidRequest, nil},
		{"rich version", `{"fields":{"description":{"schema_version":2,"document":{}}}}`, ErrInvalidRequest, nil},
		{"null list", `{"fields":{"screening_questions":null}}`, ErrValidation, nil},
		{"null compensation", `{"fields":{"compensation":null}}`, ErrValidation, nil},
		{"partial compensation", `{"fields":{"compensation":{"amount":"1"}}}`, ErrValidation, nil},
		{"value", `{"fields":{"screening_questions":[{"id":"bad","type":"open","prompt":"x"}]}}`, ErrValidation, nil},
		{"missing", `{"fields":{"screening_questions":[{"id":"bad","type":"open"}]}}`, ErrInvalidRequest, draftfields.ErrScreeningV2MissingKey},
		{"later structural beats value", `{"fields":{"title":3,"screening_questions":[{"id":"bad","type":"open","prompt":""},{"id":"bad","type":"open","prompt":"x","extra":1}]}}`, ErrInvalidRequest, draftfields.ErrScreeningV2UnknownKey},
		{"option structural beats value", `{"fields":{"screening_questions":[{"id":"bad","type":"single_choice_informative","prompt":"","options":[{"id":"bad","label":""},{"id":"bad","label":"x","extra":1}]}]}}`, ErrInvalidRequest, draftfields.ErrScreeningV2UnknownKey},
		{"budget", strings.Repeat(" ", MaxBodyBytes+1), ErrPayloadTooLarge, nil},
		{"invalid utf8", string([]byte{'{', 0xff, '}'}), ErrInvalidRequest, nil},
	} {
		t.Run(tc.name, func(t *testing.T) {
			body := []byte(tc.body)
			before := bytes.Clone(body)
			p, err := DecodePatchV2(body)
			if !errors.Is(err, tc.want) || tc.underlying != nil && !errors.Is(err, tc.underlying) {
				t.Fatalf("got %v, want %v / %v", err, tc.want, tc.underlying)
			}
			if !reflect.DeepEqual(p, PatchV2{}) {
				t.Fatal("partial result")
			}
			if !bytes.Equal(body, before) {
				t.Fatal("input mutated")
			}
		})
	}
}

func TestDecodePatchV2ScreeningVariants(t *testing.T) {
	const id = "A1111111-1111-4111-8111-111111111111"
	const option = "b2222222-2222-4222-8222-222222222222"
	for _, kind := range []string{"open", "single_choice_informative", "single_choice_evaluated"} {
		t.Run(kind, func(t *testing.T) {
			question := map[string]any{"id": id, "type": kind, "prompt": " Q "}
			expected := map[string]any{"id": id, "type": kind, "prompt": "Q"}
			if kind != "open" {
				question["options"] = []any{map[string]any{"id": option, "label": " A "}, map[string]any{"id": "c3333333-3333-4333-8333-333333333333", "label": "B"}}
				expected["options"] = []any{map[string]any{"id": option, "label": "A"}, map[string]any{"id": "c3333333-3333-4333-8333-333333333333", "label": "B"}}
			}
			if kind == "single_choice_evaluated" {
				question["correct_option_id"] = option
				expected["correct_option_id"] = option
			}
			body, _ := json.Marshal(map[string]any{"fields": map[string]any{"screening_questions": []any{question}}})
			before := bytes.Clone(body)
			p, err := DecodePatchV2(body)
			if err != nil {
				t.Fatal(err)
			}
			golden, _ := json.Marshal(map[string]any{"schema_version": 2, "fields": map[string]any{"screening_questions": []any{expected}}})
			if !bytes.Equal(p.Fingerprint(), golden) {
				t.Fatalf("got %s want %s", p.Fingerprint(), golden)
			}
			if !p.ScreeningQuestionsV2.Set || !p.ScreeningQuestionsV2.Valid || len(p.ScreeningQuestionsV2.Value) != 1 || p.ScreeningQuestionsV2.Value[0].ID != id || p.ScreeningQuestionsV2.Value[0].Prompt != "Q" {
				t.Fatal("typed result")
			}
			if !bytes.Equal(body, before) {
				t.Fatal("input mutated")
			}
		})
	}
}

func TestDecodePatchV2InclusiveBudget(t *testing.T) {
	body := []byte(`{"fields":{"title":"X"}}`)
	body = append(body, bytes.Repeat([]byte(" "), MaxBodyBytes-len(body))...)
	if _, err := DecodePatchV2(body); err != nil {
		t.Fatal(err)
	}
}
