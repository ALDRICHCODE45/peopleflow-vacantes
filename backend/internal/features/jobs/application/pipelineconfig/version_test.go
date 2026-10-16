package pipelineconfig_test

import (
	"errors"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/drafts"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/draftversion"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/pipelineconfig"
	"github.com/google/uuid"
)

func TestETag_IndependentOpaqueStrongPrecondition(t *testing.T) {
	tag := pipelineconfig.ETag(draftID, 0)
	if tag != pipelineconfig.ETag(draftID, 0) || tag == pipelineconfig.ETag(draftID, 1) || tag == pipelineconfig.ETag(uuid.New(), 0) {
		t.Fatal("tags must bind pipeline identity and version")
	}
	if _, err := draftversion.ParseIfMatchV2(tag, true); err == nil {
		t.Fatal("pipeline tag must not parse as a draft tag")
	}
	cases := []struct {
		name, value string
		present     bool
		want        error
	}{
		{"missing", "", false, drafts.ErrPreconditionRequired},
		{"empty", "", true, drafts.ErrInvalidRequest},
		{"empty quoted", `""`, true, drafts.ErrInvalidRequest},
		{"weak", "W/" + tag, true, drafts.ErrInvalidRequest},
		{"list", tag + "," + tag, true, drafts.ErrInvalidRequest},
		{"star", "*", true, drafts.ErrInvalidRequest},
		{"unquoted", "tag", true, drafts.ErrInvalidRequest},
		{"interior space", `"bad tag"`, true, drafts.ErrInvalidRequest},
		{"control", "\"bad\x7f\"", true, drafts.ErrInvalidRequest},
		{"foreign", `"foreign"`, true, drafts.ErrVersionConflict},
		{"stale", pipelineconfig.ETag(draftID, 1), true, drafts.ErrVersionConflict},
		{"current", tag, true, nil},
		{"ows", "\t " + tag + " \t", true, nil},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if err := pipelineconfig.CheckIfMatch(tag, tc.value, tc.present); !errors.Is(err, tc.want) {
				t.Fatalf("got %v want %v", err, tc.want)
			}
		})
	}
}
