//go:build integration

package postgres

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/db"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/candidates/application/usecases"
	candidatehttp "github.com/aldrichcode45/peopleflow-vacantes/internal/features/candidates/infrastructure/http"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/security"
	identitypostgres "github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/infrastructure/postgres"
)

func profileHTTP(t *testing.T) func(string, string, string, int) map[string]any {
	t.Helper()
	if testing.Short() {
		t.Skip("database test")
	}
	repo, pool := newTestRepo(t)
	t.Cleanup(pool.Close)
	user := seedUser(t, pool)
	var sub string
	if err := pool.QueryRow(context.Background(), `SELECT cognito_sub FROM users WHERE id=$1`, user).Scan(&sub); err != nil {
		t.Fatal(err)
	}
	router := candidatehttp.NewCandidateHandler(usecases.NewCandidateService(repo, identitypostgres.NewUserRepository(db.New(pool)))).Routes()
	return func(method, path, body string, status int) map[string]any {
		t.Helper()
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		req = req.WithContext(security.ContextWithClaims(req.Context(), security.Claims{Subject: sub}))
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		if rec.Code != status {
			t.Fatalf("%s %s: want %d, got %d %s", method, path, status, rec.Code, rec.Body.String())
		}
		var out map[string]any
		if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
			t.Fatal(err)
		}
		return out
	}
}

const profileStudies = `{"years_of_experience":"1.5","seniority":"junior","education":[{"level":"bachelor","institution":" UNAM ","field":" Ingeniería ","status":"completed","start_year":2015,"end_year":2020},{"level":"master","institution":null,"field":null,"status":"in_progress","start_year":2024,"end_year":null}]}`

func TestProfileHTTPHarmonizationRoundTripAndReplacement(t *testing.T) {
	request := profileHTTP(t)
	put := request(http.MethodPut, "/", profileStudies, 200)
	get := request(http.MethodGet, "/", "", 200)
	if !reflect.DeepEqual(put, get) {
		t.Fatalf("round trip mismatch: %+v / %+v", put, get)
	}
	if get["years_of_experience"] != "1.5" || get["seniority"] != "junior" {
		t.Fatalf("scalars: %+v", get)
	}
	for _, key := range []string{"education_level", "field_of_study"} {
		if _, ok := get[key]; ok {
			t.Fatalf("removed key %s", key)
		}
	}
	studies := get["education"].([]any)
	if len(studies) != 2 {
		t.Fatalf("education: %+v", studies)
	}
	first := studies[0].(map[string]any)
	second := studies[1].(map[string]any)
	for _, study := range []map[string]any{first, second} {
		if len(study) != 6 {
			t.Fatalf("exact six keys: %+v", study)
		}
	}
	if first["institution"] != "UNAM" || first["field"] != "Ingeniería" || second["end_year"] != nil {
		t.Fatalf("normalized studies: %+v", studies)
	}
	request(http.MethodPut, "/", `{"education":[{"level":"secondary","institution":null,"field":null,"status":"paused","start_year":null,"end_year":null}]}`, 200)
	replaced := request(http.MethodGet, "/", "", 200)
	if replaced["years_of_experience"] != nil || replaced["seniority"] != nil || len(replaced["education"].([]any)) != 1 {
		t.Fatalf("replacement: %+v", replaced)
	}
	request(http.MethodPut, "/", `{}`, 200)
	cleared := request(http.MethodGet, "/", "", 200)
	if len(cleared["education"].([]any)) != 0 {
		t.Fatalf("omitted education did not clear: %+v", cleared)
	}
}

func TestProfileHTTPHarmonizationRejectionPreservesData(t *testing.T) {
	request := profileHTTP(t)
	request(http.MethodPut, "/", profileStudies, 200)
	before := request(http.MethodGet, "/", "", 200)
	for _, body := range []string{
		`{"years_of_experience":1.5}`, `{"years_of_experience":"60.1"}`, `{"seniority":"mid"}`,
		`{"education":[{"level":"bachelor","institution":null,"field":null,"status":"in_progress","start_year":2020,"end_year":2021}]}`,
		`{"education":[{"level":"bachelor","institution":null,"field":null,"status":"completed","start_year":null}]}`,
		`{"education_level":"bachelor"}`,
	} {
		request(http.MethodPut, "/", body, 400)
		after := request(http.MethodGet, "/", "", 200)
		if !reflect.DeepEqual(before, after) {
			t.Fatalf("rejected request changed profile: %+v", after)
		}
	}
}

func TestProfileHTTPLanguagesCodesAndAtomicRejection(t *testing.T) {
	request := profileHTTP(t)
	body := `{"languages":[{"code":"es","level":"native"},{"code":"en","level":"B2"}]}`
	put := request(http.MethodPut, "/languages/", body, 200)
	before := request(http.MethodGet, "/languages/", "", 200)
	if !reflect.DeepEqual(put, before) {
		t.Fatalf("round trip: %+v / %+v", put, before)
	}
	entries := before["languages"].([]any)
	if len(entries) != 2 || entries[0].(map[string]any)["code"] != "en" || entries[1].(map[string]any)["level"] != "native" {
		t.Fatalf("codes: %+v", entries)
	}
	for _, entry := range entries {
		if len(entry.(map[string]any)) != 2 {
			t.Fatalf("language shape: %+v", entry)
		}
	}
	for _, bad := range []string{`{"languages":[{"code":"en","level":"B2"},{"code":"en","level":"C2"}]}`, `{"languages":[{"code":"zz","level":"B2"}]}`, `{"languages":[{"code":"es","level":"fluent"}]}`, `{"languages":[{"name":"English","level":"B2"}]}`} {
		request(http.MethodPut, "/languages/", bad, 400)
		if after := request(http.MethodGet, "/languages/", "", 200); !reflect.DeepEqual(before, after) {
			t.Fatalf("rejection changed languages: %+v", after)
		}
	}
	request(http.MethodPut, "/languages/", `{"languages":[{"code":"nah","level":"A1"}]}`, 200)
	replaced := request(http.MethodGet, "/languages/", "", 200)["languages"].([]any)
	if len(replaced) != 1 || replaced[0].(map[string]any)["code"] != "nah" {
		t.Fatalf("replacement: %+v", replaced)
	}
	request(http.MethodPut, "/languages/", `{"languages":[]}`, 200)
	if got := request(http.MethodGet, "/languages/", "", 200)["languages"].([]any); len(got) != 0 {
		t.Fatalf("clear: %+v", got)
	}
}
