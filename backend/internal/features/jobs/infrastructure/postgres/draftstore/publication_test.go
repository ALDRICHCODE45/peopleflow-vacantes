package draftstore

import (
	"bytes"
	"errors"
	"strings"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/drafts"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/pipelineconfig"
	"github.com/google/uuid"
)

func TestPublicationPayloadCanonicalizationShapeAndAddress(t *testing.T) {
	id := uuid.New()
	first, empty, err := publicationPayload(id, []byte(`{}`))
	if err != nil || !empty {
		t.Fatal(err)
	}
	second, empty, err := publicationPayload(id, []byte(" \n {  } \t"))
	if err != nil || !empty || !bytes.Equal(first, second) {
		t.Fatal("equivalent object payloads must replay")
	}
	other, _, err := publicationPayload(uuid.New(), []byte(`{}`))
	if err != nil || bytes.Equal(first, other) {
		t.Fatal("key must not replay a different draft")
	}
	for _, body := range []string{`{"extra":1}`, `null`, `[]`, `"x"`} {
		t.Run(body, func(t *testing.T) {
			different, empty, err := publicationPayload(id, []byte(body))
			if err != nil || empty || bytes.Equal(first, different) {
				t.Fatalf("must fingerprint distinct payload before replay conflict: %s %v", different, err)
			}
		})
	}
	for _, tc := range []struct {
		name, body string
		want       error
	}{{"missing", "", drafts.ErrInvalidRequest}, {"truncated", "{", drafts.ErrInvalidRequest}, {"trailing", "{} {}", drafts.ErrInvalidRequest}, {"duplicate", `{"x":1,"\u0078":1}`, drafts.ErrInvalidRequest}, {"utf8", "{\"x\":\"\xff\"}", drafts.ErrInvalidRequest}, {"surrogate", `{"x":"\uD800"}`, drafts.ErrInvalidRequest}, {"budget", strings.Repeat("x", pipelineconfig.MaxBodyBytes+1), drafts.ErrPayloadTooLarge}} {
		t.Run(tc.name, func(t *testing.T) {
			got, empty, err := publicationPayload(id, []byte(tc.body))
			if !errors.Is(err, tc.want) || got != nil || empty {
				t.Fatalf("%s %v %v", got, empty, err)
			}
		})
	}
}
