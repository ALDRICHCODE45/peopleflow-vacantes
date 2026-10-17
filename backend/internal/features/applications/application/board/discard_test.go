package board_test

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/draftjson"

	app "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/application/board"
)

func TestDiscardReasonKeyContract(t *testing.T) {
	for _, tc := range []struct {
		name, body string
		want       error
	}{
		{"key accepted", `{"reason":{"group":"candidate","key":"unresponsive"}}`, nil},
		// The escaped legacy spelling exercises the decoded JSON member name.
		{"legacy member rejected", `{"reason":{"group":"candidate","\u0063ode":"unresponsive"}}`, app.ErrInvalidRequest},
		{"mixed members rejected", `{"reason":{"group":"candidate","key":"unresponsive","\u0063ode":"unresponsive"}}`, app.ErrInvalidRequest},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, err := app.DecodeDiscard([]byte(tc.body), draftjson.Decode)
			if !errors.Is(err, tc.want) {
				t.Fatalf("got %v, want %v", err, tc.want)
			}
		})
	}
	raw, err := json.Marshal(app.Reason{Group: "candidate", Key: "unresponsive"})
	if err != nil {
		t.Fatal(err)
	}
	var obj map[string]any
	if err = json.Unmarshal(raw, &obj); err != nil {
		t.Fatal(err)
	}
	if len(obj) != 2 || obj["group"] != "candidate" || obj["key"] != "unresponsive" {
		t.Fatalf("reason must contain exactly group/key: %s", raw)
	}
}

func TestDiscardCatalogPairs(t *testing.T) {
	groups := []string{"recruiter", "candidate", "unknown", ""}
	codes := []string{"requirements_not_met", "profile_mismatch", "salary_expectation", "other_candidate_selected", "accepted_other_offer", "no_longer_interested", "unresponsive", "other", "unknown", ""}
	for _, g := range groups {
		for _, c := range codes {
			t.Run(g+"/"+c, func(t *testing.T) {
				valid := (g == "recruiter" && (c == "requirements_not_met" || c == "profile_mismatch" || c == "salary_expectation" || c == "other_candidate_selected" || c == "other")) || (g == "candidate" && (c == "accepted_other_offer" || c == "no_longer_interested" || c == "unresponsive" || c == "other"))
				raw, _ := json.Marshal(map[string]any{"reason": map[string]string{"group": g, "key": c}, "comment": "explanation"})
				_, err := app.DecodeDiscard(raw, draftjson.Decode)
				if (err == nil) != valid || (!valid && !errors.Is(err, app.ErrValidation)) {
					t.Fatal(valid, err)
				}
				if valid {
					raw, _ = json.Marshal(map[string]any{"reason": map[string]string{"group": g, "key": c}})
					_, err = app.DecodeDiscard(raw, draftjson.Decode)
					if c == "other" {
						if !errors.Is(err, app.ErrValidation) {
							t.Fatal(err)
						}
					} else if err != nil {
						t.Fatal(err)
					}
				}
			})
		}
	}
}

func TestDiscardTextAndOther(t *testing.T) {
	for _, field := range []string{"comment", "candidate_message"} {
		t.Run(field, func(t *testing.T) {
			limit := 1000
			if field == "candidate_message" {
				limit = 500
			}
			for _, tc := range []struct {
				name, text string
				valid      bool
				want       string
			}{
				{"one", "😀", true, "😀"}, {"boundary emoji", strings.Repeat("😀", limit), true, strings.Repeat("😀", limit)},
				{"too many emoji", strings.Repeat("😀", limit+1), false, ""},
				{"combining boundary", strings.Repeat("e\u0301", limit/2), true, strings.Repeat("e\u0301", limit/2)},
				{"combining counts separately", strings.Repeat("e\u0301", limit/2) + "x", false, ""},
				{"white space trim", "\u0085\u00a0\u1680\u2000\u2028\u2029\u202f\u205f\u3000 x \t\n\u00a0", true, "x"},
				{"interior kept", " a\n\tb  c ", true, "a\n\tb  c"},
				{"empty", "", false, ""}, {"trim empty", "\u00a0\t\n", false, ""},
				{"nul", "a\x00b", false, ""}, {"cr", "a\rb", false, ""}, {"del", "a\x7fb", false, ""}, {"c1", "a\u0085b", false, ""},
			} {
				t.Run(tc.name, func(t *testing.T) {
					raw, _ := json.Marshal(map[string]any{"reason": map[string]string{"group": "candidate", "key": "unresponsive"}, field: tc.text})
					got, err := app.DecodeDiscard(raw, draftjson.Decode)
					if (err == nil) != tc.valid || (!tc.valid && !errors.Is(err, app.ErrValidation)) {
						t.Fatal(err)
					}
					if tc.valid {
						value := got.Comment
						if field == "candidate_message" {
							value = got.CandidateMessage
						}
						if value == nil || *value != tc.want {
							t.Fatal(value)
						}
					}
				})
			}
		})
	}
	for _, g := range []string{"candidate", "recruiter"} {
		for _, code := range []string{"other", "unresponsive"} {
			t.Run(g+code, func(t *testing.T) {
				raw, _ := json.Marshal(map[string]any{"reason": map[string]string{"group": g, "key": code}})
				_, err := app.DecodeDiscard(raw, draftjson.Decode)
				if code == "other" && !errors.Is(err, app.ErrValidation) {
					t.Fatal(err)
				}
			})
		}
	}
}

func TestDiscardRecoverStrictBodies(t *testing.T) {
	reason := `"reason":{"group":"recruiter","key":"profile_mismatch"}`
	for _, body := range []string{`null`, `[]`, `{}`, `{"reason":null}`, `{"reason":{}}`, `{` + reason + `,"extra":1}`, `{` + reason + `,"comment":null}`, `{` + reason + `,"candidate_message":42}`, `{` + reason + `,"confirm_placement_exit":null}`, `{` + reason + `,"confirm_placement_exit":"true"}`, `{` + reason + `,` + reason + `}`, `{"reason":{"group":"recruiter","group":"candidate","key":"other"}}`, `{"reason":{"group":"recruiter","key":"other","x":1}}`, `{"reason":{"group":1,"key":"other"}}`, `{` + reason + `} {}`} {
		t.Run(body, func(t *testing.T) {
			if _, err := app.DecodeDiscard([]byte(body), draftjson.Decode); !errors.Is(err, app.ErrInvalidRequest) {
				t.Fatal(err)
			}
		})
	}
	for _, body := range []string{`{` + reason + `}`, `{` + reason + `,"confirm_placement_exit":true}`} {
		if _, err := app.DecodeDiscard([]byte(body), draftjson.Decode); err != nil {
			t.Fatal(err)
		}
	}
	for _, tc := range []struct {
		body  string
		valid bool
	}{{`{}`, true}, {`{"confirm_placement_reentry":false}`, true}, {`{"confirm_placement_reentry":true}`, true}, {`null`, false}, {`[]`, false}, {`{"confirm_placement_reentry":null}`, false}, {`{"confirm_placement_reentry":"true"}`, false}, {`{"confirm_placement_reentry":true,"confirm_placement_reentry":false}`, false}, {`{"confirm":true}`, false}} {
		t.Run(tc.body, func(t *testing.T) {
			_, err := app.DecodeRecover([]byte(tc.body), draftjson.Decode)
			if (err == nil) != tc.valid {
				t.Fatal(err)
			}
		})
	}
}

func TestDiscardHistoryUnion(t *testing.T) {
	text := "private"
	reason := &app.Reason{Group: "candidate", Key: "other"}
	for _, kind := range []string{"intake", "move", "discard", "recovery"} {
		t.Run(kind, func(t *testing.T) {
			raw, err := json.Marshal(app.Entry{Kind: kind, Reason: reason, Comment: &text, CandidateMessage: &text})
			if err != nil {
				t.Fatal(err)
			}
			var obj map[string]any
			if err = json.Unmarshal(raw, &obj); err != nil {
				t.Fatal(err)
			}
			keys := []string{"kind", "from_stage_id", "to_stage_id", "hire", "departure", "actor", "at"}
			if kind == "discard" {
				keys = append(keys, "reason", "comment", "candidate_message")
				if obj["comment"] != text || obj["candidate_message"] != text {
					t.Fatal(obj)
				}
			}
			if len(obj) != len(keys) {
				t.Fatal(obj)
			}
			for _, k := range keys {
				if _, ok := obj[k]; !ok {
					t.Fatal(k, obj)
				}
			}
			if kind != "discard" && strings.Contains(string(raw), text) {
				t.Fatal("private text leaked into another history variant", obj)
			}
		})
	}
	raw, _ := json.Marshal(app.Entry{Kind: "discard", Reason: reason})
	var obj map[string]any
	_ = json.Unmarshal(raw, &obj)
	for _, k := range []string{"comment", "candidate_message"} {
		v, ok := obj[k]
		if !ok || v != nil {
			t.Fatal(obj)
		}
	}
}

func TestDiscardProjectionNulls(t *testing.T) {
	for _, tc := range []struct {
		name  string
		value any
		keys  []string
	}{
		{"item", app.Item{}, []string{"discard"}},
		{"detail", app.Detail{}, []string{"discard", "comment", "candidate_message"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			raw, err := json.Marshal(tc.value)
			if err != nil {
				t.Fatal(err)
			}
			var obj map[string]any
			if err = json.Unmarshal(raw, &obj); err != nil {
				t.Fatal(err)
			}
			for _, key := range tc.keys {
				v, ok := obj[key]
				if !ok || v != nil {
					t.Errorf("%s must be present and null: %s", key, raw)
				}
			}
		})
	}
}
