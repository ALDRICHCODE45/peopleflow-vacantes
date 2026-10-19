package board

import (
	"encoding/json"
	"errors"
	"testing"

	"github.com/google/uuid"
)

func TestNotApplicableHistoryExactKeys(t *testing.T) {
	raw, err := json.Marshal(Entry{Kind: "not_applicable", ToStageID: uuid.NewString(), Actor: Actor{Kind: "recruiter"}})
	if err != nil {
		t.Fatal(err)
	}
	var obj map[string]any
	if err = json.Unmarshal(raw, &obj); err != nil {
		t.Fatal(err)
	}
	if len(obj) != 4 || obj["kind"] != "not_applicable" || obj["stage_id"] == nil || obj["actor"] == nil || obj["at"] == nil {
		t.Fatal(string(raw))
	}
}

func TestRecoveryTargetRemovedRangeAndExisting(t *testing.T) {
	p := Pipeline{Stages: []Stage{{ID: "new"}, {ID: "screening"}, {ID: "in_process"}, {ID: "placement"}}, Retired: []RetiredStage{{ID: "gone", Position: 2}}}
	for _, tc := range []struct {
		name, previous string
		target         *string
		want           string
		override       bool
		err            error
	}{
		{"existing", "screening", nil, "screening", false, nil},
		{"existing target prohibited", "screening", str("new"), "", false, ErrValidation},
		{"removed requires target", "gone", nil, "", false, ErrRecoveryStageRequired},
		{"default", "gone", str("screening"), "screening", true, nil},
		{"earlier", "gone", str("new"), "new", true, nil},
		{"later", "gone", str("in_process"), "", false, ErrValidation},
		{"unknown", "gone", str("other"), "", false, ErrValidation},
	} {
		t.Run(tc.name, func(t *testing.T) {
			target, override, err := RecoveryTarget(p, tc.previous, RecoverRequest{ToStageID: tc.target})
			if target != tc.want || override != tc.override || !errors.Is(err, tc.err) {
				t.Fatal(target, override, err)
			}
		})
	}
}
func str(s string) *string { return &s }

func TestRecoverTargetStrictBody(t *testing.T) {
	decode := func(raw []byte) (any, error) { var v any; err := json.Unmarshal(raw, &v); return v, err }
	for _, tc := range []struct {
		name, body string
		want       error
	}{
		{"absent", `{}`, nil},
		{"target", `{"to_stage_id":"11111111-1111-4111-8111-111111111111"}`, nil},
		{"null", `{"to_stage_id":null}`, ErrInvalidRequest},
		{"bad id", `{"to_stage_id":"bad"}`, ErrInvalidRequest},
		{"extra", `{"target":"x"}`, ErrInvalidRequest},
		{"bad flag", `{"confirm_placement_reentry":null}`, ErrInvalidRequest},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, err := DecodeRecover([]byte(tc.body), decode)
			if !errors.Is(err, tc.want) {
				t.Fatal(err)
			}
		})
	}
}
