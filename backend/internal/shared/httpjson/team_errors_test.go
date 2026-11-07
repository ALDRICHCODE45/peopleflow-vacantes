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

func TestWriteTeamOffboardVacancies(t *testing.T) {
	vacancies := []map[string]string{{"id": "v1"}}
	for _, code := range []Code{"member_is_responsible", "offboard_unresolved_vacancies"} {
		t.Run(string(code), func(t *testing.T) {
			rec := httptest.NewRecorder()
			WriteTeamOffboardVacancies(rec, code, vacancies)
			def := Resolve(code)
			want := `{"error":"` + def.Message + `","code":"` + string(code) + `","data":{"vacancies":[{"id":"v1"}]}}` + "\n"
			if rec.Code != def.Status || rec.Body.String() != want {
				t.Fatalf("%d %s", rec.Code, rec.Body.String())
			}
		})
	}
	// Other codes never carry offboard data through this seam.
	rec := httptest.NewRecorder()
	WriteTeamOffboardVacancies(rec, "team_last_member", vacancies)
	if rec.Code != 409 || rec.Body.String() != `{"error":"team last member","code":"team_last_member"}`+"\n" {
		t.Fatalf("%d %s", rec.Code, rec.Body.String())
	}
}
