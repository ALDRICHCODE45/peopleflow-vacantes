//go:build integration

package v2

import (
	"context"
	"encoding/json"
	"testing"

	app "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/application/v2"
	"github.com/google/uuid"
)

// The professional title is frozen at application time like every other
// company-visible profile field: the board reads the copy, never the live
// candidate profile; a company correction wins; legacy copies read as null.
func TestProfessionalTitleSnapshotBoardCardAndDetail(t *testing.T) {
	m := setupMovement(t)
	ctx := context.Background()
	var candidate uuid.UUID
	if err := m.pool.QueryRow(ctx, `SELECT id FROM users WHERE cognito_sub=$1`, m.other).Scan(&candidate); err != nil {
		t.Fatal(err)
	}
	if _, err := m.pool.Exec(ctx, `INSERT INTO candidate_profiles(user_id,professional_title,skills) VALUES($1,'Backend Engineer','{}')`, candidate); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		for _, q := range []string{`DELETE FROM company_candidate_corrections WHERE user_id=$1`, `DELETE FROM candidate_profiles WHERE user_id=$1`} {
			if _, err := m.pool.Exec(context.Background(), q, candidate); err != nil {
				t.Error(err)
			}
		}
	})
	cv, err := m.library.Upload(ctx, m.other, "CV", "cv.pdf", []byte("%PDF-1"))
	if err != nil {
		t.Fatal(err)
	}
	result, err := m.store.Apply(ctx, m.other, m.vacancy, uuid.New(), m.request(cv.ID))
	if err != nil {
		t.Fatal(err)
	}
	assertNoFilterData(t, result.Body)
	var submitted app.Submitted
	if err = json.Unmarshal(result.Body, &submitted); err != nil {
		t.Fatal(err)
	}
	var raw []byte
	if err = m.pool.QueryRow(ctx, `SELECT profile_snapshot FROM process_participations WHERE id=$1`, submitted.ID).Scan(&raw); err != nil {
		t.Fatal(err)
	}
	if got := movementObject(t, raw)["professional_title"]; got != "Backend Engineer" {
		t.Fatalf("snapshot title = %v (%s)", got, raw)
	}
	// The candidate edits the profile afterwards: the company keeps the copy.
	if _, err = m.pool.Exec(ctx, `UPDATE candidate_profiles SET professional_title='Changed Later' WHERE user_id=$1`, candidate); err != nil {
		t.Fatal(err)
	}
	title := func() (detail, card, original any) {
		t.Helper()
		r := movementRequest(t, m, "GET", m.vacancy, submitted.ID, "", "", "")
		if r.Code != 200 {
			t.Fatal(r.Code, r.Body.String())
		}
		d := movementObject(t, r.Body.Bytes())
		detail = d["profile"].(map[string]any)["professional_title"]
		if o, ok := d["original"].(map[string]any); ok {
			original = o["professional_title"]
		}
		b := movementRequest(t, m, "GET", m.vacancy, uuid.Nil, "", "", "")
		if b.Code != 200 {
			t.Fatal(b.Code, b.Body.String())
		}
		card = "missing"
		for _, rawItem := range movementObject(t, b.Body.Bytes())["participations"].([]any) {
			item := rawItem.(map[string]any)
			if item["id"] == submitted.ID.String() {
				card = item["profile"].(map[string]any)["professional_title"]
			}
		}
		return detail, card, original
	}
	if detail, card, original := title(); detail != "Backend Engineer" || card != "Backend Engineer" || original != nil {
		t.Fatalf("frozen title: detail=%v card=%v original=%v", detail, card, original)
	}
	// A company correction wins; the original view keeps this participation's copy.
	if _, err = m.pool.Exec(ctx, `INSERT INTO company_candidate_corrections(company_id,user_id,corrections) VALUES($1,$2,'{"professional_title":"Corrected Title"}')`, m.company, candidate); err != nil {
		t.Fatal(err)
	}
	if detail, card, original := title(); detail != "Corrected Title" || card != "Corrected Title" || original != "Backend Engineer" {
		t.Fatalf("corrected title: detail=%v card=%v original=%v", detail, card, original)
	}
	// A correction to "no title" is an explicit null that still wins.
	if _, err = m.pool.Exec(ctx, `UPDATE company_candidate_corrections SET corrections='{"professional_title":null}' WHERE user_id=$1`, candidate); err != nil {
		t.Fatal(err)
	}
	if detail, card, original := title(); detail != nil || card != nil || original != "Backend Engineer" {
		t.Fatalf("null correction: detail=%v card=%v original=%v", detail, card, original)
	}
	// Legacy copies taken before the key existed read as null, never live.
	if _, err = m.pool.Exec(ctx, `DELETE FROM company_candidate_corrections WHERE user_id=$1`, candidate); err != nil {
		t.Fatal(err)
	}
	if _, err = m.pool.Exec(ctx, `UPDATE process_participations SET profile_snapshot=profile_snapshot-'professional_title' WHERE id=$1`, submitted.ID); err != nil {
		t.Fatal(err)
	}
	if detail, card, _ := title(); detail != nil || card != nil {
		t.Fatalf("legacy title: detail=%v card=%v", detail, card)
	}
}
