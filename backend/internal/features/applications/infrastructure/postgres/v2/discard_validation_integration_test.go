//go:build integration

package v2

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	board "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/application/board"
)

func TestDiscardCatalogAndTextRejectionsAreAtomic(t *testing.T) {
	m := setupMovement(t)
	item := m.item
	for _, group := range []string{"recruiter", "candidate", "unknown", ""} {
		for _, code := range []string{"requirements_not_met", "profile_mismatch", "salary_expectation", "other_candidate_selected", "accepted_other_offer", "no_longer_interested", "unresponsive", "other", "unknown", ""} {
			t.Run(group+"/"+code, func(t *testing.T) {
				valid := (group == "recruiter" && (code == "requirements_not_met" || code == "profile_mismatch" || code == "salary_expectation" || code == "other_candidate_selected" || code == "other")) || (group == "candidate" && (code == "accepted_other_offer" || code == "no_longer_interested" || code == "unresponsive" || code == "other"))
				raw, _ := json.Marshal(map[string]any{"reason": map[string]string{"group": group, "key": code}, "comment": "explanation"})
				before := m.snapshot(t)
				out, err := m.discard(t, item, string(raw))
				if !valid {
					if !errors.Is(err, board.ErrValidation) || before != m.snapshot(t) {
						t.Fatal("invalid catalog pair changed state", err)
					}
					return
				}
				if err != nil || out.Discard == nil || out.Discard.Reason.Group != group || out.Discard.Reason.Key != code {
					t.Fatal(out, err)
				}
				recovered, err := m.recover(t, out.Item, `{}`)
				if err != nil {
					t.Fatal(err)
				}
				item = recovered.Item
			})
		}
	}
	for _, field := range []string{"comment", "candidate_message"} {
		limit := 1000
		if field == "candidate_message" {
			limit = 500
		}
		for _, text := range []string{"", "\u00a0\u3000", strings.Repeat("😀", limit+1), strings.Repeat("e\u0301", limit/2) + "x", "a\r b", "a\x00b", "a\x7fb", "a\u0085b"} {
			t.Run(field+" invalid", func(t *testing.T) {
				raw, _ := json.Marshal(map[string]any{"reason": map[string]string{"group": "candidate", "key": "unresponsive"}, field: text})
				before := m.snapshot(t)
				_, err := m.discard(t, item, string(raw))
				if !errors.Is(err, board.ErrValidation) || before != m.snapshot(t) {
					t.Fatal(err)
				}
			})
		}
		for _, text := range []string{strings.Repeat("😀", limit), strings.Repeat("e\u0301", limit/2), "\u0085\u00a0a\n\tb\u3000"} {
			t.Run(field+" boundary accepted", func(t *testing.T) {
				raw, _ := json.Marshal(map[string]any{"reason": map[string]string{"group": "candidate", "key": "unresponsive"}, field: text})
				out, err := m.discard(t, item, string(raw))
				if err != nil {
					t.Fatal(err)
				}
				detail, err := m.board.Detail(context.Background(), m.company, m.recruiter, m.vacancy, item.ID)
				if err != nil {
					t.Fatal(err)
				}
				got := detail.Comment
				if field == "candidate_message" {
					got = detail.CandidateMessage
				}
				if got == nil || *got != strings.TrimSpace(text) {
					t.Fatal(got)
				}
				recovered, err := m.recover(t, out.Item, `{}`)
				if err != nil {
					t.Fatal(err)
				}
				item = recovered.Item
			})
		}
	}
	for _, group := range []string{"candidate", "recruiter"} {
		for _, comment := range []any{nil, "", "\u00a0\t\n"} {
			t.Run(group+" other requires text", func(t *testing.T) {
				payload := map[string]any{"reason": map[string]string{"group": group, "key": "other"}}
				if comment != nil {
					payload["comment"] = comment
				}
				raw, _ := json.Marshal(payload)
				before := m.snapshot(t)
				_, err := m.discard(t, item, string(raw))
				if !errors.Is(err, board.ErrValidation) || before != m.snapshot(t) {
					t.Fatal(err)
				}
			})
		}
	}
	// Strict malformed body rejections, also with current state already discarded.
	out, err := m.discard(t, item, discardBody)
	if err != nil {
		t.Fatal(err)
	}
	item = out.Item
	for _, body := range []string{`null`, `[]`, `{"reason":null}`, `{"reason":{"group":"candidate","key":"unresponsive","x":1}}`, `{"reason":{"group":"candidate","key":"unresponsive"},"comment":null}`, `{"reason":{"group":"candidate","key":"unresponsive"},"reason":{"group":"candidate","key":"unresponsive"}}`, `{"reason":{"group":"candidate","\u0063ode":"unresponsive"}}`, "{\"reason\":\"\xff\"}"} {
		before := m.snapshot(t)
		_, err := m.discard(t, item, body)
		if !errors.Is(err, board.ErrInvalidRequest) || before != m.snapshot(t) {
			t.Fatal(err)
		}
	}
	for _, body := range []string{`null`, `{"confirm_placement_reentry":null}`, `{"confirm_placement_reentry":false,"confirm_placement_reentry":true}`, `{"unexpected":true}`} {
		before := m.snapshot(t)
		_, err := m.recover(t, item, body)
		if !errors.Is(err, board.ErrInvalidRequest) || before != m.snapshot(t) {
			t.Fatal(err)
		}
	}
}
