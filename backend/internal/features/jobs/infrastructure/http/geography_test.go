package http

import (
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/vacancygeo"
)

func TestDraftGeographyErrorDetails(t *testing.T) {
	for _, remote := range []bool{false, true} {
		t.Run(fmt.Sprint(remote), func(t *testing.T) {
			w := httptest.NewRecorder()
			writeDraftError(w, fmt.Errorf("context: %w", &vacancygeo.Invalid{Remote: remote, Details: []vacancygeo.Detail{{Field: "fields.location.municipality", Reason: "mismatch"}}}))
			var body struct {
				Details []vacancygeo.Detail `json:"details"`
			}
			if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
				t.Fatal(err)
			}
			if w.Code != 422 || len(body.Details) != 1 || body.Details[0].Field != "fields.location.municipality" || body.Details[0].Reason != "mismatch" {
				t.Fatal(w.Code, w.Body)
			}
		})
	}
}
