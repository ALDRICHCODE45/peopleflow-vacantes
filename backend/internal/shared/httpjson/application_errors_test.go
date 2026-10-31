package httpjson

import (
	"encoding/json"
	"net/http/httptest"
	"testing"
)

// §10.5 error codes extend, rather than rewrite, the baseline catalog.
func TestApplicationErrorExtension(t *testing.T) {
	for _, tc := range []struct {
		code   Code
		status int
	}{
		{"message_unavailable", 409}, {"message_changed", 409}, {"cv_storage_unavailable", 503}, {"cv_too_large", 413}, {"cv_unsupported_type", 415}, {"cv_content_mismatch", 400}, {"cv_library_full", 409}, {"questionnaire_changed", 409}, {"already_applied", 409}, {"invalid_answers", 422}, {"cv_unavailable", 422},
	} {
		t.Run(string(tc.code), func(t *testing.T) {
			got := Resolve(tc.code)
			if got.Code != tc.code || got.Status != tc.status {
				t.Fatalf("got %+v", got)
			}
		})
	}
}
func TestOnlyInvalidAnswersHasDetails(t *testing.T) {
	for _, code := range []Code{CodeInvalidRequest, CodeInvalidAnswers} {
		t.Run(string(code), func(t *testing.T) {
			w := httptest.NewRecorder()
			WriteApplicationError(w, Resolve(code), []AnswerDetail{{"q", "required"}})
			var body map[string]any
			if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
				t.Fatal(err)
			}
			_, has := body["details"]
			if has != (code == CodeInvalidAnswers) {
				t.Fatal(body)
			}
			if _, has := body["data"]; has {
				t.Fatal(body)
			}
		})
	}
}
