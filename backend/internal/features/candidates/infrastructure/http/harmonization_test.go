package http

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"testing"

	identityentities "github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/entities"
	"github.com/google/uuid"
)

func TestHarmonizedProfileValidation(t *testing.T) {
	education := `{"level":"bachelor","institution":null,"field":null,"status":"completed","start_year":null,"end_year":null}`
	cases := []struct{ name, body, field, code string }{
		{"numeric years", `{"years_of_experience":1}`, "years_of_experience", "invalid"},
		{"fraction precision", `{"years_of_experience":"1.50"}`, "years_of_experience", "invalid"},
		{"leading zero", `{"years_of_experience":"01"}`, "years_of_experience", "invalid"},
		{"above maximum", `{"years_of_experience":"60.1"}`, "years_of_experience", "invalid"},
		{"negative", `{"years_of_experience":"-1"}`, "years_of_experience", "invalid"},
		{"seniority literal", `{"seniority":"Junior"}`, "seniority", "invalid"},
		{"seniority type", `{"seniority":1}`, "seniority", "invalid"},
		{"education type", `{"education":{}}`, "education", "invalid"},
		{"education limit", `{"education":[` + strings.TrimSuffix(strings.Repeat(education+",", 11), ",") + `]}`, "education", "too_long"},
	}
	for _, key := range []string{"level", "institution", "field", "status", "start_year", "end_year"} {
		var obj map[string]any
		if err := json.Unmarshal([]byte(education), &obj); err != nil {
			t.Fatal(err)
		}
		delete(obj, key)
		raw, _ := json.Marshal(obj)
		cases = append(cases, struct{ name, body, field, code string }{"missing " + key, `{"education":[` + string(raw) + `]}`, "education[0]." + key, "required"})
	}
	for _, c := range []struct{ key, value, code string }{
		{"level", `"college"`, "invalid"}, {"level", `null`, "required"},
		{"status", `"finished"`, "invalid"}, {"status", `null`, "required"},
		{"institution", `"   "`, "invalid"}, {"field", `"   "`, "invalid"},
		{"institution", fmt.Sprintf("%q", strings.Repeat("é", 121)), "too_long"},
		{"field", fmt.Sprintf("%q", strings.Repeat("é", 121)), "too_long"},
		{"start_year", `1949`, "invalid"}, {"end_year", `2101`, "invalid"},
		{"start_year", `2000.5`, "invalid"}, {"end_year", `"2000"`, "invalid"},
	} {
		var obj map[string]json.RawMessage
		_ = json.Unmarshal([]byte(education), &obj)
		obj[c.key] = json.RawMessage(c.value)
		raw, _ := json.Marshal(obj)
		cases = append(cases, struct{ name, body, field, code string }{c.key + " " + c.value, `{"education":[` + string(raw) + `]}`, "education[0]." + c.key, c.code})
	}
	cases = append(cases,
		struct{ name, body, field, code string }{"reversed years", `{"education":[{"level":"master","institution":null,"field":null,"status":"completed","start_year":2025,"end_year":2020}]}`, "education[0].end_year", "invalid"},
		struct{ name, body, field, code string }{"ongoing end", `{"education":[{"level":"master","institution":null,"field":null,"status":"in_progress","start_year":2020,"end_year":2025}]}`, "education[0].end_year", "not_allowed"},
	)
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			repo := &stubCandidateRepo{}
			router := newTestRouter(newTestHandler(repo, &stubUserRepo{resolved: &identityentities.User{ID: uuid.New()}}))
			rec := doRequest(t, router, authedRequest(t, http.MethodPut, "/me/profile/", tc.body, "subject"))
			var response struct {
				Code   string                         `json:"code"`
				Fields []struct{ Field, Code string } `json:"fields"`
			}
			if err := json.Unmarshal(rec.Body.Bytes(), &response); err != nil {
				t.Fatal(err)
			}
			if rec.Code != 400 || response.Code != "validation_error" {
				t.Fatalf("want validation_error, got %d %s", rec.Code, rec.Body.String())
			}
			found := false
			for _, f := range response.Fields {
				if f.Field == tc.field && f.Code == tc.code {
					found = true
				}
			}
			if !found {
				t.Errorf("missing %s/%s: %s", tc.field, tc.code, rec.Body.String())
			}
			if repo.upsertCalls != 0 {
				t.Fatal("invalid input reached persistence")
			}
		})
	}
}

func TestHarmonizedLanguagesValidation(t *testing.T) {
	for _, tc := range []struct{ name, body, field, code string }{
		{"unknown", `{"languages":[{"code":"zz","level":"B2"}]}`, "languages[0].code", "invalid"},
		{"literal", `{"languages":[{"code":"ES","level":"B2"}]}`, "languages[0].code", "invalid"},
		{"missing code", `{"languages":[{"level":"B2"}]}`, "languages[0].code", "required"},
		{"missing level", `{"languages":[{"code":"es"}]}`, "languages[0].level", "required"},
		{"level", `{"languages":[{"code":"es","level":"b2"}]}`, "languages[0].level", "invalid"},
		{"duplicate", `{"languages":[{"code":"es","level":"B2"},{"code":"es","level":"C1"}]}`, "languages[1].code", "duplicate"},
		{"limit", `{"languages":[` + strings.TrimSuffix(strings.Repeat(`{"code":"es","level":"B2"},`, 11), ",") + `]}`, "languages", "too_long"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			repo := &stubCandidateRepo{}
			router := newTestRouter(newTestHandler(repo, &stubUserRepo{resolved: &identityentities.User{ID: uuid.New()}}))
			rec := doRequest(t, router, authedRequest(t, http.MethodPut, "/me/profile/languages/", tc.body, "subject"))
			var response struct {
				Code   string                         `json:"code"`
				Fields []struct{ Field, Code string } `json:"fields"`
			}
			_ = json.Unmarshal(rec.Body.Bytes(), &response)
			if rec.Code != 400 || response.Code != "validation_error" {
				t.Fatalf("want validation_error, got %d %s", rec.Code, rec.Body.String())
			}
			found := false
			for _, f := range response.Fields {
				if f.Field == tc.field && f.Code == tc.code {
					found = true
				}
			}
			if !found {
				t.Errorf("missing %s/%s: %s", tc.field, tc.code, rec.Body.String())
			}
			if repo.replaceCalls != 0 {
				t.Fatal("invalid input reached persistence")
			}
		})
	}
}
