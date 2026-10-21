package board

import (
	"github.com/google/uuid"
	"testing"
)

func TestManualFingerprint(t *testing.T) {
	draft := uuid.MustParse("10000000-0000-0000-0000-000000000001")
	original := []byte(`{"stage_id":null,"existing":null,"confirmed_distinct":false,"candidate":{"full_name":"Ana Pérez","skills":["go","sql"]}}`)
	same := []byte(` { "candidate": {"skills":["go","sql"],"full_name":"Ana P\u00e9rez"}, "existing":null,"stage_id":null,"confirmed_distinct":false } `)
	want, err := ManualFingerprint(draft, original, []byte("CV bytes"))
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		name     string
		draft    uuid.UUID
		data, cv []byte
		equal    bool
	}{
		{"canonical JSON", draft, same, []byte("CV bytes"), true},
		{"changed CV", draft, same, []byte("other bytes"), false},
		{"changed draft", uuid.MustParse("10000000-0000-0000-0000-000000000002"), same, []byte("CV bytes"), false},
		{"changed data", draft, []byte(`{"candidate":null,"existing":null,"stage_id":null,"confirmed_distinct":false}`), []byte("CV bytes"), false},
		{"array order matters", draft, []byte(`{"stage_id":null,"existing":null,"confirmed_distinct":false,"candidate":{"full_name":"Ana Pérez","skills":["sql","go"]}}`), []byte("CV bytes"), false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got, err := ManualFingerprint(tc.draft, tc.data, tc.cv)
			if err != nil {
				t.Fatal(err)
			}
			if (got == want) != tc.equal {
				t.Fatalf("fingerprint equality = %v, want %v", got == want, tc.equal)
			}
		})
	}
	for _, raw := range []string{`{"a":1,"a":2}`, `{"candidate":{"x":1,"x":2}}`, `{} {}`, `null`, `[]`, `{"a":`} {
		t.Run("reject "+raw, func(t *testing.T) {
			if _, err := ManualFingerprint(draft, []byte(raw), nil); err == nil {
				t.Fatal("accepted ambiguous or invalid JSON")
			}
		})
	}
}
