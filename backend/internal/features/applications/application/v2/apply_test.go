package v2

import (
	"bytes"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/draftjson"
	"github.com/google/uuid"
)

var qOpen = "11111111-1111-4111-8111-111111111111"
var qChoice = "22222222-2222-4222-8222-222222222222"
var option = "33333333-3333-4333-8333-333333333333"

func form() Screening {
	return Screening{Questions: []Question{{ID: qOpen, Type: "open"}, {ID: qChoice, Type: "single_choice"}}}
}
func decodeApply(body []byte) (Request, error) { return Decode(body, draftjson.Decode) }

// §10.5: strict payload shape and trimmed open answers.
func TestDecodeApplyStrictAndCanonical(t *testing.T) {
	cv := uuid.New().String()
	a := `{"cv_id":"` + cv + `","questionnaire_revision":"revision","answers":[{"question_id":"` + qOpen + `","text":"  hola  "}]}`
	req, err := decodeApply(aBytes(a))
	if err != nil {
		t.Fatal(err)
	}
	if req.Answers[0].Text != "hola" {
		t.Fatal("text not trimmed")
	}
	for _, body := range []string{`{}`, strings.Replace(a, `"cv_id":`, `"extra":1,"cv_id":`, 1), strings.Replace(a, `"text":"  hola  "`, `"text":"a","text":"b"`, 1), strings.Replace(a, `"answers":[`, `"answers":null,"ignored":[`, 1)} {
		if _, err := decodeApply(aBytes(body)); !errors.Is(err, ErrInvalidRequest) {
			t.Fatalf("accepted %s: %v", body, err)
		}
	}
}
func TestFingerprintDoesNotReplayDifferentAnswerShape(t *testing.T) {
	base := Request{CVID: uuid.New(), Revision: "r", Answers: []Answer{{QuestionID: qOpen, Text: "ok", HasText: true}}}
	a, _ := Fingerprint(base)
	changed := base
	changed.Answers = append([]Answer{}, base.Answers...)
	changed.Answers[0].HasOption = true
	b, _ := Fingerprint(changed)
	if bytes.Equal(a, b) {
		t.Fatal("extra empty option hidden by fingerprint")
	}
	changed.Answers[0].HasOption = false
	changed.Answers[0].WrongType = true
	b, _ = Fingerprint(changed)
	if bytes.Equal(a, b) {
		t.Fatal("wrong type hidden by fingerprint")
	}
}
func aBytes(s string) []byte { return []byte(s) }
func TestValidateAnswers(t *testing.T) {
	f := form()
	for _, tc := range []struct {
		name         string
		answers      string
		code, reason string
	}{
		{"missing", `[]`, "invalid_answers", "required"},
		{"missing_value", `[{"question_id":"` + qOpen + `"}]`, "invalid_answers", "required"},
		{"number_value", `[{"question_id":"` + qOpen + `","text":123}]`, "invalid_answers", "wrong_type"},
		{"empty", `[{"question_id":"` + qOpen + `","text":" "}]`, "invalid_answers", "required"},
		{"long", `[{"question_id":"` + qOpen + `","text":"` + strings.Repeat("界", 2001) + `"}]`, "invalid_answers", "too_long"},
		{"wrong_type", `[{"question_id":"` + qOpen + `","option_id":"` + option + `"}]`, "invalid_answers", "wrong_type"},
		{"unknown_option", `[{"question_id":"` + qOpen + `","text":"ok"},{"question_id":"` + qChoice + `","option_id":"` + option + `"}]`, "invalid_answers", "unknown_option"},
		{"unknown_question", `[{"question_id":"` + uuid.NewString() + `","text":"x"}]`, "invalid_request", ""},
		{"duplicate", `[{"question_id":"` + qOpen + `","text":"x"},{"question_id":"` + qOpen + `","text":"y"}]`, "invalid_request", ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			raw := `{"cv_id":"` + uuid.NewString() + `","questionnaire_revision":"r","answers":` + tc.answers + `}`
			req, err := decodeApply([]byte(raw))
			if err != nil {
				t.Fatal(err)
			}
			err = ValidateAnswers(f, req.Answers)
			if tc.code == "invalid_request" {
				if !errors.Is(err, ErrInvalidRequest) {
					t.Fatal(err)
				}
				return
			}
			var invalid *InvalidAnswers
			if !errors.As(err, &invalid) {
				t.Fatal(err)
			}
			target := qOpen
			if tc.name == "unknown_option" {
				target = qChoice
			}
			found := false
			for _, d := range invalid.Details {
				if d.QuestionID == target && d.Reason == tc.reason {
					found = true
				}
			}
			if !found {
				b, _ := json.Marshal(invalid)
				t.Fatal(string(b))
			}
		})
	}
}
