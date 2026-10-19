package publicjobs

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/draftinput"
)

// §10.5: public questions never expose scoring or answer keys.
func TestBuildScreeningPrivacyRevisionAndNullOptions(t *testing.T) {
	const questions = `[{"id":"11111111-1111-4111-8111-111111111111","type":"open","prompt":"Why?"},{"id":"22222222-2222-4222-8222-222222222222","type":"single_choice_evaluated","prompt":"Choose","options":[{"id":"33333333-3333-4333-8333-333333333333","label":"A"},{"id":"44444444-4444-4444-8444-444444444444","label":"B"}],"correct_option_id":"33333333-3333-4333-8333-333333333333"}]`
	d, err := draftinput.DecodeCreateV2([]byte(`{"fields":{"screening_questions":` + questions + `}}`))
	if err != nil {
		t.Fatal(err)
	}
	got, err := BuildScreening(d.Fingerprint())
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(got)
	if !strings.Contains(string(raw), `"options":null`) || strings.Contains(string(raw), "evaluated") || strings.Contains(string(raw), "correct_option") {
		t.Fatal(string(raw))
	}
	if len(got.Questions) != 2 || got.Revision == "" || got.Limits.OpenAnswerMaxLength != 2000 {
		t.Fatal(string(raw))
	}
	again, _ := BuildScreening(d.Fingerprint())
	if again.Revision != got.Revision {
		t.Fatal("unstable fingerprint")
	}
	modified, _ := draftinput.DecodeCreateV2([]byte(`{"fields":{"screening_questions":` + strings.Replace(questions, "Why?", "How?", 1) + `}}`))
	changed, _ := BuildScreening(modified.Fingerprint())
	if changed.Revision == got.Revision {
		t.Fatal("revision did not change")
	}
	keyEdit := strings.Replace(questions, `"correct_option_id":"33333333-3333-4333-8333-333333333333"`, `"correct_option_id":"44444444-4444-4444-8444-444444444444"`, 1)
	privateEdit, err := draftinput.DecodeCreateV2([]byte(`{"fields":{"screening_questions":` + keyEdit + `}}`))
	if err != nil {
		t.Fatal(err)
	}
	unchanged, err := BuildScreening(privateEdit.Fingerprint())
	if err != nil || unchanged.Revision != got.Revision {
		t.Fatal("revision exposed private answer-key change", err)
	}
	empty, _ := draftinput.DecodeCreateV2([]byte(`{"fields":{}}`))
	form, err := BuildScreening(empty.Fingerprint())
	if err != nil || form.Questions == nil || len(form.Questions) != 0 {
		t.Fatal(form, err)
	}
}
