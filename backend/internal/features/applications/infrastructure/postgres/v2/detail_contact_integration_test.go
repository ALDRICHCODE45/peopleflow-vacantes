//go:build integration

package v2

import (
	"context"
	"encoding/json"
	"testing"
)

// The participation detail exposes every available contact for both origins
// (user decision L16): the company record for manual candidates, the account
// email and profile phone for organic ones, including organic reuse.
func TestDetailContactManualOrganicAndReuse(t *testing.T) {
	ctx := context.Background()
	str := func(v *string) string {
		if v == nil {
			return "<nil>"
		}
		return *v
	}
	t.Run("organic", func(t *testing.T) {
		m := setupMovement(t)
		detail, err := m.board.Detail(ctx, m.company, m.recruiter, m.vacancy, m.item.ID)
		if err != nil {
			t.Fatal(err)
		}
		if str(detail.Contact.Email) != m.sub+"@example.test" || detail.Contact.Phone != nil {
			t.Fatalf("organic without profile phone: %s %s", str(detail.Contact.Email), str(detail.Contact.Phone))
		}
		t.Cleanup(func() {
			if _, err := m.pool.Exec(ctx, `DELETE FROM candidate_profiles WHERE user_id=$1`, m.actor); err != nil {
				t.Error(err)
			}
		})
		if _, err = m.pool.Exec(ctx, `INSERT INTO candidate_profiles(user_id,phone) VALUES($1,'+525512345678') ON CONFLICT(user_id) DO UPDATE SET phone=excluded.phone`, m.actor); err != nil {
			t.Fatal(err)
		}
		detail, err = m.board.Detail(ctx, m.company, m.recruiter, m.vacancy, m.item.ID)
		if err != nil || str(detail.Contact.Phone) != "+525512345678" {
			t.Fatal("organic profile phone", str(detail.Contact.Phone), err)
		}
	})
	t.Run("manual", func(t *testing.T) {
		m := manualReadFixture(t, false)
		if _, err := m.pool.Exec(ctx, `UPDATE company_candidates SET phone='+525598765432' WHERE id=(SELECT company_candidate_id FROM process_participations WHERE id=$1)`, m.item.ID); err != nil {
			t.Fatal(err)
		}
		detail, err := m.board.Detail(ctx, m.company, m.recruiter, m.vacancy, m.item.ID)
		if err != nil || str(detail.Contact.Email) != "manual@example.test" || str(detail.Contact.Phone) != "+525598765432" {
			t.Fatal("manual contact", str(detail.Contact.Email), str(detail.Contact.Phone), err)
		}
	})
	t.Run("organic reused as manual", func(t *testing.T) {
		m := manualReadFixture(t, true)
		detail, err := m.board.Detail(ctx, m.company, m.recruiter, m.vacancy, m.item.ID)
		if err != nil || str(detail.Contact.Email) != m.sub+"@example.test" {
			t.Fatal("reused contact", str(detail.Contact.Email), err)
		}
		raw, _ := json.Marshal(detail)
		var out map[string]any
		if err = json.Unmarshal(raw, &out); err != nil {
			t.Fatal(err)
		}
		contact, ok := out["contact"].(map[string]any)
		if !ok || len(contact) != 2 {
			t.Fatalf("contact shape: %s", raw)
		}
		if _, ok := contact["phone"]; !ok {
			t.Fatalf("phone key must be present: %s", raw)
		}
	})
}
