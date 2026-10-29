package profile_test

import (
	"reflect"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/psychometrics/application/profile"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/shared/httpjson"
)

func l25Body(t *testing.T) map[string]any {
	t.Helper()
	m := body(t, profile.Empty())
	for _, x := range m["competencies"].([]any) {
		x.(map[string]any)["rationale"] = nil
	}
	return m
}
func TestL25DefaultsAndIrrelevantConfirmation(t *testing.T) {
	defaults := body(t, profile.Empty())
	for _, x := range defaults["competencies"].([]any) {
		if x.(map[string]any)["rationale"] != nil {
			t.Fatal("default rationale must be null")
		}
	}
	m := l25Body(t)
	m["confirmed"] = true
	if _, err := profile.Replace(encoded(m), nil); err != nil {
		t.Fatal(err)
	}
}
func TestL25ForbiddenFields(t *testing.T) {
	for _, confirmed := range []bool{false, true} {
		for _, tc := range []struct {
			importance, key string
			value           any
		}{
			{"importance.no_relevante", "desired_band", "band.high"},
			{"importance.no_relevante", "rationale", ""},
			{"importance.no_relevante", "rationale", "Trabajo"},
			{"importance.no_relevante", "task", ""},
			{"importance.no_relevante", "task", "Trabajo"},
			{"importance.importante", "task", ""},
			{"importance.importante", "task", "Trabajo"},
		} {
			t.Run(tc.importance+"/"+tc.key+"/"+map[bool]string{false: "draft", true: "confirmed"}[confirmed]+"/"+tc.value.(string), func(t *testing.T) {
				m := l25Body(t)
				m["confirmed"] = confirmed
				c := entry(m)
				c["importance"] = tc.importance
				if tc.importance == "importance.importante" {
					c["desired_band"] = "band.low"
					c["rationale"] = "Trabajo"
				}
				c[tc.key] = tc.value
				_, err := profile.Replace(encoded(m), nil)
				inv, ok := err.(*profile.Invalid)
				want := []httpjson.ValidationField{{Field: "competencies[0]." + tc.key, Code: "not_allowed"}}
				if !ok || !reflect.DeepEqual(inv.Fields, want) {
					t.Fatalf("err=%v want=%v", err, want)
				}
			})
		}
	}
}
func TestL25RelevantDraftsAndConfirmation(t *testing.T) {
	for _, importance := range []string{"importance.clave", "importance.importante"} {
		for _, rationale := range []any{nil, "", "  ", " Trabajo "} {
			for _, confirmed := range []bool{false, true} {
				t.Run(importance+"/"+map[bool]string{false: "draft", true: "confirmed"}[confirmed]+"/"+map[bool]string{false: "empty", true: "text"}[rationale == " Trabajo "], func(t *testing.T) {
					m := l25Body(t)
					m["confirmed"] = confirmed
					c := entry(m)
					c["importance"] = importance
					c["desired_band"] = "band.medium"
					c["rationale"] = rationale
					if importance == "importance.clave" {
						c["task"] = " Tarea "
					}
					p, err := profile.Replace(encoded(m), nil)
					if rationale == nil {
						// A relevant entry always carries a string rationale, "" while drafting.
						inv, ok := err.(*profile.Invalid)
						if !ok || !reflect.DeepEqual(inv.Fields, []httpjson.ValidationField{{Field: "competencies[0].rationale", Code: "invalid"}}) {
							t.Fatalf("err=%v", err)
						}
						return
					}
					if confirmed && rationale != " Trabajo " {
						inv, ok := err.(*profile.Invalid)
						if !ok || !reflect.DeepEqual(inv.Fields, []httpjson.ValidationField{{Field: "competencies[0].rationale", Code: "required"}}) {
							t.Fatalf("err=%v", err)
						}
						return
					}
					if err != nil {
						t.Fatal(err)
					}
					b := body(t, p)
					want := rationale
					if rationale == "  " {
						want = ""
					}
					if rationale == " Trabajo " {
						want = "Trabajo"
					}
					if !reflect.DeepEqual(entry(b)["rationale"], want) {
						t.Fatal(b)
					}
				})
			}
		}
	}
}
