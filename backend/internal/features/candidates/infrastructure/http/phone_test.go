package http

import (
	"encoding/json"
	"net/http"
	"testing"

	identityentities "github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/entities"
	"github.com/google/uuid"
)

// The profile phone follows the same exact E.164 rule as manual intake
// (sharedvo.NewPhone): '+', 8–15 digits, nonzero first digit, +52 with
// exactly ten national digits, no whitespace normalization.
func TestProfilePhoneValidation(t *testing.T) {
	for _, phone := range []string{
		"5512345678",        // no '+'
		"+52 55 1234 5678",  // whitespace is not normalized
		"+52551234567",      // +52 with nine national digits
		"+5255123456789",    // +52 with eleven national digits
		"+0123456789",       // zero country prefix
		"+1234567",          // seven digits
		"+1234567890123456", // sixteen digits
		"+1-555-123-4567",   // separators
		"   ",
	} {
		t.Run(phone, func(t *testing.T) {
			repo := &stubCandidateRepo{}
			router := newTestRouter(newTestHandler(repo, &stubUserRepo{resolved: &identityentities.User{ID: uuid.New()}}))
			body, _ := json.Marshal(map[string]string{"phone": phone})
			rec := doRequest(t, router, authedRequest(t, http.MethodPut, "/me/profile/", string(body), "subject"))
			var response struct {
				Code   string                         `json:"code"`
				Fields []struct{ Field, Code string } `json:"fields"`
			}
			if err := json.Unmarshal(rec.Body.Bytes(), &response); err != nil {
				t.Fatal(err)
			}
			if rec.Code != 400 || response.Code != "validation_error" || len(response.Fields) != 1 ||
				response.Fields[0].Field != "phone" || response.Fields[0].Code != "invalid" {
				t.Fatalf("want 400 validation_error phone/invalid, got %d %s", rec.Code, rec.Body.String())
			}
			if repo.upsertCalls != 0 {
				t.Fatal("invalid phone reached persistence")
			}
		})
	}

	for _, tc := range []struct {
		name, body string
		want       *string
	}{
		{"mexico", `{"phone":"+525512345678"}`, strp("+525512345678")},
		{"other country", `{"phone":"+14155552671"}`, strp("+14155552671")},
		{"null clears", `{"phone":null}`, nil},
		{"omitted clears", `{}`, nil},
		{"empty clears", `{"phone":""}`, nil},
	} {
		t.Run(tc.name, func(t *testing.T) {
			repo := &stubCandidateRepo{}
			router := newTestRouter(newTestHandler(repo, &stubUserRepo{resolved: &identityentities.User{ID: uuid.New()}}))
			rec := doRequest(t, router, authedRequest(t, http.MethodPut, "/me/profile/", tc.body, "subject"))
			if rec.Code != http.StatusOK {
				t.Fatalf("want 200, got %d %s", rec.Code, rec.Body.String())
			}
			got := repo.upserted.Phone
			if (got == nil) != (tc.want == nil) || (got != nil && *got != *tc.want) {
				t.Fatalf("persisted phone = %v, want %v", deref(got), deref(tc.want))
			}
			var response struct {
				Phone *string `json:"phone"`
			}
			_ = json.Unmarshal(rec.Body.Bytes(), &response)
			if deref(response.Phone) != deref(tc.want) {
				t.Fatalf("response phone = %q, want %q", deref(response.Phone), deref(tc.want))
			}
		})
	}
}

func strp(s string) *string { return &s }

func deref(s *string) string {
	if s == nil {
		return "<nil>"
	}
	return *s
}
