package httpjson

import (
	"net/http/httptest"
	"testing"
)

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
