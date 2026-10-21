package draftstore

import (
	"bytes"
	"errors"
	"strings"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/drafts"
	"github.com/google/uuid"
)

func TestLifecyclePayloadShapeCanonicalizationAndScope(t *testing.T) {
	id := uuid.New()
	first, choice, err := lifecyclePayload(id, "close", []byte(`{"process":"continue","reason":"cancelled","reason_note":null}`))
	if err != nil || choice != "continue" {
		t.Fatal(choice, err)
	}
	same, _, err := lifecyclePayload(id, "close", []byte(" \n { \"process\" : \"continue\", \"reason_note\":null, \"reason\":\"cancelled\" } "))
	if err != nil || !bytes.Equal(first, same) {
		t.Fatal("not canonical", err)
	}
	for _, tc := range []struct {
		name         string
		id           uuid.UUID
		action, body string
	}{
		{"other draft", uuid.New(), "close", `{"process":"continue","reason":"cancelled","reason_note":null}`}, {"different choice", id, "close", `{"process":"finish","reason":"cancelled","reason_note":null}`}, {"different action", id, "pause", `{}`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got, _, err := lifecyclePayload(tc.id, tc.action, []byte(tc.body))
			if err != nil || bytes.Equal(first, got) {
				t.Fatal("fingerprint scope", err)
			}
		})
	}
	for _, tc := range []struct {
		name, action, body string
		want               error
	}{
		{"empty", "pause", ``, drafts.ErrInvalidRequest}, {"null", "pause", `null`, drafts.ErrInvalidRequest}, {"array", "pause", `[]`, drafts.ErrInvalidRequest},
		{"unknown key", "resume", `{"extra":true}`, drafts.ErrInvalidRequest}, {"close missing", "close", `{}`, drafts.ErrInvalidRequest}, {"close bad choice", "close", `{"process":"active"}`, drafts.ErrInvalidRequest},
		{"close null", "close", `{"process":null}`, drafts.ErrInvalidRequest}, {"close duplicate", "close", `{"process":"finish","process":"finish"}`, drafts.ErrInvalidRequest},
		{"malformed", "pause", `{`, drafts.ErrInvalidRequest}, {"trailing", "pause", `{} {}`, drafts.ErrInvalidRequest}, {"oversize", "pause", strings.Repeat("x", 1048577), drafts.ErrPayloadTooLarge},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, _, err := lifecyclePayload(id, tc.action, []byte(tc.body))
			if !errors.Is(err, tc.want) {
				t.Fatal(err, tc.want)
			}
		})
	}
}
