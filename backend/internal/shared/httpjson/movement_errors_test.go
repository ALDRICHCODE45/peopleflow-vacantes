package httpjson

import "testing"

func TestMovementErrorExtension(t *testing.T) {
	for _, tc := range []struct {
		code   Code
		status int
	}{
		{"stage_skip_not_allowed", 409}, {"placement_exit_confirmation_required", 409}, {"vacancy_not_published", 409}, {"board_too_large", 422}, {"stage_change_requires_empty_pipeline", 409},
	} {
		t.Run(string(tc.code), func(t *testing.T) {
			got := Resolve(tc.code)
			if got.Code != tc.code || got.Status != tc.status || got.Message == "" {
				t.Fatal(got)
			}
		})
	}
}
