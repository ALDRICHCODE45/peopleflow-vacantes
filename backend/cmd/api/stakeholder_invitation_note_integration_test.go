//go:build integration

package main

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"github.com/google/uuid"
)

// The optional invitation note (audit gap D11, stakeholder-metrics-v1 §1.3):
// trimmed, NFC, 1..80 code points, no control characters; absent or blank is
// null. Returned by the create and the list, never written to audit metadata.

func shCreateWithBody(t *testing.T, h *draftFlowHarness, ownerToken, body string) draftFlowResponse {
	t.Helper()
	return h.do(t, "POST", shInvitationsPath, body, ownerToken, map[string]string{"Content-Type": "application/json"})
}

func shStoredNote(t *testing.T, h *draftFlowHarness, id uuid.UUID) *string {
	t.Helper()
	var note *string
	if err := h.pool.QueryRow(t.Context(), `SELECT note FROM stakeholder_invitations WHERE id=$1`, id).Scan(&note); err != nil {
		t.Fatal(err)
	}
	return note
}

func TestStakeholderInvitations_NoteIsStoredAndReturned(t *testing.T) {
	h := newDraftFlowHarness(t)
	company, ownerID, ownerSub := draftFlowNewPrincipal(t, h.pool, "active")
	token := h.signer.validToken(t, ownerSub)

	notes := map[uuid.UUID]any{}
	for _, tc := range []struct {
		body string
		want any
	}{
		{``, nil}, // no body at all, as every client before D11
		{`{}`, nil},
		{`{"note":null}`, nil},
		{`{"note":""}`, nil},
		{`{"note":"  \n "}`, nil},
		{`{"note":"  Consejo directivo  "}`, "Consejo directivo"},
		{`{"note":"José"}`, "José"},
		{`{"note":"` + strings.Repeat("ñ", 80) + `"}`, strings.Repeat("ñ", 80)},
		{`{"note":"Para Ana","other":1}`, "Para Ana"}, // unknown keys are ignored
	} {
		r := shCreateWithBody(t, h, token, tc.body)
		if r.status != http.StatusCreated {
			t.Fatalf("%s: %d %s", tc.body, r.status, r.body)
		}
		body := orgCandidateKeys(t, draftFlowObject(t, r.body), "id", "url_token", "expires_at", "created_at", "note")
		if body["note"] != tc.want {
			t.Fatalf("%s: note %v, want %v", tc.body, body["note"], tc.want)
		}
		id := draftFlowUUID(t, body["id"].(string))
		stored := shStoredNote(t, h, id)
		if (tc.want == nil) != (stored == nil) || (stored != nil && *stored != tc.want) {
			t.Fatalf("%s: stored %v", tc.body, stored)
		}
		notes[id] = tc.want
	}

	list := h.do(t, "GET", shInvitationsPath, "", token, nil)
	if list.status != 200 {
		t.Fatalf("list %d %s", list.status, list.body)
	}
	items := draftFlowObject(t, list.body)["items"].([]any)
	if len(items) != len(notes) {
		t.Fatalf("items %d", len(items))
	}
	for _, raw := range items {
		item := orgCandidateKeys(t, raw, "id", "created_at", "created_by", "expires_at", "note")
		want, ok := notes[draftFlowUUID(t, item["id"].(string))]
		if !ok || item["note"] != want || item["created_by"] != ownerID.String() {
			t.Fatalf("item %v, want note %v", item, want)
		}
	}

	// The note never reaches audit metadata: only the catalog's ids/enums.
	rows := auditRowsOf(t, h.pool, company.companyID, "StakeholderInvitationCreated")
	if len(rows) != len(notes) {
		t.Fatalf("audit rows %d", len(rows))
	}
	for _, row := range rows {
		assertAuditRow(t, row, wantAuditRow{actor: ownerID, eventType: "StakeholderInvitationCreated", entityType: "stakeholder_invitation", entityID: row.EntityID, company: company.companyID,
			metadata: map[string]any{"invitation_id": row.EntityID.String(), "expires_at": row.Metadata["expires_at"]}})
	}
	if n := draftFlowCount(t, h.pool, `SELECT count(*) FROM audit_events WHERE company_id=$1 AND (metadata::text LIKE '%Consejo%' OR metadata::text LIKE '%Para Ana%' OR metadata ? 'note')`, company.companyID); n != 0 {
		t.Fatalf("audit metadata carries the note in %d rows", n)
	}
}

func TestStakeholderInvitations_InvalidNoteIsRejectedWithoutWrites(t *testing.T) {
	h := newDraftFlowHarness(t)
	company, _, ownerSub := draftFlowNewPrincipal(t, h.pool, "active")
	token := h.signer.validToken(t, ownerSub)
	companies := []uuid.UUID{company.companyID}
	tooLong, _ := json.Marshal(map[string]string{"note": strings.Repeat("a", 81)})
	for name, body := range map[string]string{
		"81 runes":      string(tooLong),
		"81 multibyte":  `{"note":"` + strings.Repeat("ñ", 81) + `"}`,
		"inner newline": `{"note":"Para\nAna"}`,
		"inner tab":     `{"note":"Para\tAna"}`,
		"NUL":           `{"note":"Para\u0000Ana"}`,
		"number":        `{"note":12}`,
		"object":        `{"note":{}}`,
		"array":         `{"note":["a"]}`,
		"boolean":       `{"note":true}`,
	} {
		t.Run(name, func(t *testing.T) {
			before := shInvitationState(t, h, company.companyID)
			r := shCreateWithBody(t, h, token, body)
			if r.status != 400 {
				t.Fatalf("%d %s", r.status, r.body)
			}
			editJSONEqual(t, draftFlowObject(t, r.body), map[string]any{"error": "validation failed", "code": "validation_error", "fields": []any{map[string]any{"field": "note", "code": "invalid"}}})
			if shInvitationState(t, h, company.companyID) != before {
				t.Fatal("rejected note changed invitations, members or audit")
			}
		})
	}
	for name, body := range map[string]string{
		"not json":    `not json`,
		"two values":  `{} {}`,
		"array body":  `[]`,
		"string body": `"note"`,
	} {
		t.Run(name, func(t *testing.T) {
			shRejected(t, h, companies, func() draftFlowResponse { return shCreateWithBody(t, h, token, body) }, 400, "invalid_request", "invalid request")
		})
	}
}
