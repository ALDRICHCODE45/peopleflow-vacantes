package httpjson

import (
	"net/http/httptest"
	"strings"
	"testing"
)

func TestTeamExplicitInputErrorsCatalog(t *testing.T) {
	for _, code := range []Code{"recruiter_deadline_not_applicable", "responsible_not_applicable"} {
		t.Run(string(code), func(t *testing.T) {
			rec := httptest.NewRecorder()
			WriteCatalogError(rec, Resolve(code))
			want := `{"error":"` + strings.ReplaceAll(string(code), "_", " ") + `","code":"` + string(code) + `"}` + "\n"
			if rec.Code != 422 || rec.Body.String() != want {
				t.Fatalf("%d %s", rec.Code, rec.Body.String())
			}
		})
	}
}

func TestTeamAccessEndedCatalog(t *testing.T) {
	rec := httptest.NewRecorder()
	WriteCatalogError(rec, Resolve(Code("team_access_ended")))
	if rec.Code != 404 || rec.Body.String() != `{"error":"team access ended","code":"team_access_ended"}`+"\n" {
		t.Fatalf("%d %s", rec.Code, rec.Body.String())
	}
	// An unknown code must still fail closed.
	if got := Resolve(Code("unknown_team_code")); got.Code != CodeInternalError || got.Status != 500 {
		t.Fatal(got)
	}
}
