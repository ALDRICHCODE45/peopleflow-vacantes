//go:build integration

package v2

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/google/uuid"
)

func TestMovementScreeningChoiceSnapshotNoScoring(t *testing.T) {
	m := setupMovement(t)
	question, option := uuid.NewString(), uuid.NewString()
	// Synthetic persisted snapshots include extra private fields to prove that the
	// recruiter projector returns only the agreed question/answer vocabulary.
	questions := `[{"id":"` + question + `","prompt":"Frozen choice?","type":"single_choice","options":[{"id":"` + option + `","label":"Frozen option"}],"correct_option_id":"private-key","evaluated":true},{"id":"` + uuid.NewString() + `","prompt":"Frozen open?","type":"open","options":null}]`
	var qs []struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal([]byte(questions), &qs); err != nil {
		t.Fatal(err)
	}
	answers := `[{"question_id":"` + question + `","option_id":"` + option + `"},{"question_id":"` + qs[1].ID + `","text":"Original text"}]`
	if _, err := m.pool.Exec(context.Background(), `UPDATE process_participations SET questions_snapshot=$2,answers_snapshot=$3 WHERE id=$1`, m.item.ID, []byte(questions), []byte(answers)); err != nil {
		t.Fatal(err)
	}
	detail, err := m.board.Detail(context.Background(), m.company, m.recruiter, m.vacancy, m.item.ID)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := json.Marshal(detail)
	if err != nil {
		t.Fatal(err)
	}
	var out map[string]any
	if err = json.Unmarshal(raw, &out); err != nil {
		t.Fatal(err)
	}
	// Cut 5 (§13.6) adds discard, comment and candidate_message, null unless discarded.
	if len(out) != 13 || out["discard"] != nil || out["comment"] != nil || out["candidate_message"] != nil {
		t.Fatal("detail keys drifted", string(raw))
	}
	screening := out["screening"].([]any)
	if len(screening) != 2 {
		t.Fatal(screening)
	}
	choice := screening[0].(map[string]any)
	answer := choice["answer"].(map[string]any)
	if len(choice) != 4 || choice["prompt"] != "Frozen choice?" || choice["type"] != "single_choice" || len(answer) != 2 || answer["option_id"] != option || answer["label"] != "Frozen option" {
		t.Fatal(string(raw))
	}
	open := screening[1].(map[string]any)["answer"].(map[string]any)
	if len(open) != 1 || open["text"] != "Original text" {
		t.Fatal(string(raw))
	}
	for _, forbidden := range []string{"correct_option_id", "evaluated", "private-key", "score", "correctness"} {
		if strings.Contains(string(raw), forbidden) {
			t.Fatal("scoring/private field leaked", string(raw))
		}
	}
}
