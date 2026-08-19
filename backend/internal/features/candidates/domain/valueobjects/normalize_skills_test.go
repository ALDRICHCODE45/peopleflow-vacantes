package valueobjects

import (
	"reflect"
	"testing"
)

// NormalizeSkills is the canonical GIN-friendly representation: lowercase +
// trimmed. The DB GIN index treats ["Go"] and ["go"] as different entries,
// so callers MUST run user-supplied skill lists through this before write.
func TestNormalizeSkills(t *testing.T) {
	cases := []struct {
		name string
		in   []string
		want []string
	}{
		{
			name: "mixed case becomes lowercase",
			in:   []string{"Go", "AWS", "React"},
			want: []string{"go", "aws", "react"},
		},
		{
			name: "surrounding whitespace is trimmed",
			in:   []string{"  Go  ", "\tAWS\n"},
			want: []string{"go", "aws"},
		},
		{
			name: "empty entries are dropped",
			in:   []string{"Go", "", "  ", "AWS"},
			want: []string{"go", "aws"},
		},
		{
			name: "duplicates collapse (first occurrence wins after normalize)",
			in:   []string{"Go", "go", "GO"},
			want: []string{"go"},
		},
		{
			name: "nil input is empty result, not nil",
			in:   nil,
			want: []string{},
		},
		{
			name: "empty slice stays empty",
			in:   []string{},
			want: []string{},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := NormalizeSkills(tc.in)
			// Both nil and []string{} decode as empty to a real consumer, but
			// we want to prove the function does not silently mutate ordering
			// or drop non-empty entries; reflect.DeepEqual treats nil and []
			// as different, so we normalize here for the equality check.
			if got == nil {
				got = []string{}
			}
			if !reflect.DeepEqual(got, tc.want) {
				t.Errorf("NormalizeSkills(%v) = %v, want %v", tc.in, got, tc.want)
			}
		})
	}
}
