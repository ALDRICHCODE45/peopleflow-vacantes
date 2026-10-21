package board

import (
	"bytes"
	"encoding/json"
	"testing"

	app "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/application/board"
	"github.com/google/uuid"
)

func TestManualCreatedBodyUsesGETItem(t *testing.T) {
	item := app.Item{ID: uuid.New(), Source: "manual", Profile: app.Profile{Skills: []string{"go"}}, ScreeningAnswers: []app.ScreeningAnswer{}}
	cover := app.Coverage{Covered: 2}
	delivery := app.Delivery{State: "pending", Delivered: 1, Target: 3}
	body, err := marshalManualItem(item, cover, delivery)
	if err != nil {
		t.Fatal(err)
	}
	getItem, err := json.Marshal(item)
	if err != nil {
		t.Fatal(err)
	}
	coverage, _ := json.Marshal(cover)
	delivered, _ := json.Marshal(delivery)
	// Compare bytes, not just decoded values: the complete GET item key order
	// must be retained, followed only by coverage and delivery.
	want := append(append([]byte{}, getItem[:len(getItem)-1]...), []byte(`,"coverage":`)...)
	want = append(want, coverage...)
	want = append(want, []byte(`,"delivery":`)...)
	want = append(want, delivered...)
	want = append(want, '}')
	if !bytes.Equal(body, want) {
		t.Fatalf("intake body differs from full GET item\ngot: %s\nwant: %s", body, want)
	}
	if !bytes.Contains(body, []byte(`"screening_answers":[]`)) {
		t.Fatal("missing empty screening answers", string(body))
	}
}
