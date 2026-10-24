package valueobjects

import (
	"reflect"
	"testing"
)

func TestNormalizeSkills(t *testing.T) {
	cases := []struct {
		name     string
		in, want []string
	}{
		{"typed casing", []string{"React", "TypeScript", "SQL"}, []string{"React", "TypeScript", "SQL"}},
		{"whitespace", []string{"  React  ", "\tTypeScript\n", " SQL   Server "}, []string{"React", "TypeScript", "SQL Server"}},
		{"empty entries", []string{"React", "", "  ", "SQL"}, []string{"React", "SQL"}},
		{"first casing wins", []string{"React", "react", "REACT"}, []string{"React"}},
		{"legacy casing", []string{"react", "React"}, []string{"react"}},
		{"nil", nil, []string{}},
		{"empty", []string{}, []string{}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := NormalizeSkills(tc.in)
			if !reflect.DeepEqual(got, tc.want) {
				t.Errorf("NormalizeSkills(%v) = %v, want %v", tc.in, got, tc.want)
			}
		})
	}
}
