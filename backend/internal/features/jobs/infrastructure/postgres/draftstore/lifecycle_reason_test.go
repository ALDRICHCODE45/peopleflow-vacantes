package draftstore

import (
	"bytes"
	"errors"
	"strings"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/drafts"
	"github.com/google/uuid"
)

func TestLifecycleCloseReasonBody(t *testing.T) {
	id := uuid.New()
	for _, body := range []string{
		`{"process":"continue"}`,
		`{"process":"continue","reason":"unknown","reason_note":null}`,
		`{"process":"continue","reason":"filled","reason_note":"note"}`,
		`{"process":"continue","reason":"cancelled","reason_note":""}`,
		`{"process":"continue","reason":"other"}`,
		`{"process":"continue","reason":"other","reason_note":null}`,
		`{"process":"continue","reason":"other","reason_note":""}`,
		`{"process":"continue","reason":"other","reason_note":" \t\n "}`,
		`{"process":"continue","reason":"other","reason_note":123}`,
		`{"process":"continue","reason":"other","reason_note":"` + strings.Repeat("界", 201) + `"}`,
		`{"process":"continue","reason":"filled"}`,
		`{"reason":"cancelled","reason_note":null}`,
		`{"process":"continue","reason":null,"reason_note":null}`,
		`{"process":"continue","reason":"filled","reason_note":null,"extra":true}`,
	} {
		t.Run(body, func(t *testing.T) {
			_, _, err := lifecyclePayload(id, "close", []byte(body))
			if !errors.Is(err, drafts.ErrInvalidRequest) {
				t.Fatalf("got %v", err)
			}
		})
	}
	for _, reason := range []string{"filled", "cancelled"} {
		_, _, err := lifecyclePayload(id, "close", []byte(`{"process":"finish","reason":"`+reason+`","reason_note":null}`))
		if err != nil {
			t.Fatal(err)
		}
	}
	note := strings.Repeat("界", 200)
	padded := []byte(`{"process":"continue","reason":"other","reason_note":"  ` + note + `  "}`)
	a, _, err := lifecyclePayload(id, "close", padded)
	if err != nil {
		t.Fatal(err)
	}
	b, _, err := lifecyclePayload(id, "close", []byte(`{"process":"continue","reason":"other","reason_note":"`+note+`"}`))
	if err != nil || !bytes.Equal(a, b) {
		t.Fatal("trimmed canonical body", err)
	}
	replay, err := lifecycleFingerprint(id, "close", padded)
	if err != nil || !bytes.Equal(a, replay) {
		t.Fatal("replay canonical body differs", err)
	}
}
