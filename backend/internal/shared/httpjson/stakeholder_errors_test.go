package httpjson

import (
	"encoding/json"
	"net/http/httptest"
	"testing"
)

// The stakeholder catalog entries (stakeholder-metrics-v1 §1.2-§1.3).
func TestStakeholderCatalog(t *testing.T) {
	want := []Definition{
		{CodeInvitationInvalid, 404, "invitation is invalid or expired"},
		{CodeInvitationLimitReached, 422, "too many pending invitations"},
		{CodeCandidateAccount, 403, "candidate accounts cannot join a company"},
		{CodeAlreadyCompanyMember, 409, "user already belongs to a company"},
		{CodeStakeholderRoleChangeNotSupported, 422, "stakeholder role changes are not supported"},
	}
	codes := StakeholderErrorCodes()
	if len(codes) != len(want) {
		t.Fatalf("codes = %v", codes)
	}
	for i, w := range want {
		if codes[i] != w.Code {
			t.Errorf("codes[%d] = %q, want %q", i, codes[i], w.Code)
		}
		if got := Resolve(w.Code); got != w {
			t.Errorf("Resolve(%q) = %+v, want %+v", w.Code, got, w)
		}
		recorder := httptest.NewRecorder()
		WriteCatalogError(recorder, Resolve(w.Code))
		var body map[string]any
		if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil {
			t.Fatal(err)
		}
		if recorder.Code != w.Status || len(body) != 2 || body["code"] != string(w.Code) || body["error"] != w.Message {
			t.Errorf("response = %d %s", recorder.Code, recorder.Body.String())
		}
	}
	codes[0] = CodeInternalError
	if StakeholderErrorCodes()[0] != CodeInvitationInvalid {
		t.Fatal("catalog list was mutated")
	}
}
