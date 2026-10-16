package substatecatalog_test

import (
	"errors"
	"strings"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/drafts"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/draftversion"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/pipelineconfig"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/substatecatalog"
	"github.com/google/uuid"
)

func TestETag_IndependentOpaqueStrongPrecondition(t *testing.T) {
	id := uuid.New()
	tag := substatecatalog.ETag(id, 0)
	if tag != substatecatalog.ETag(id, 0) || tag == substatecatalog.ETag(id, 1) || tag == substatecatalog.ETag(uuid.New(), 0) || tag == pipelineconfig.ETag(id, 0) || !strings.HasPrefix(tag, `"`) || !strings.HasSuffix(tag, `"`) {
		t.Fatal("tags must be strong and bind catalog identity/version independently")
	}
	if _, err := draftversion.ParseIfMatchV2(tag, true); err == nil {
		t.Fatal("catalog tag parsed as draft tag")
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
		{"unquoted", "bad", true, drafts.ErrInvalidRequest},
		{"foreign pipeline", pipelineconfig.ETag(id, 0), true, drafts.ErrVersionConflict},
		{"stale", substatecatalog.ETag(id, 1), true, drafts.ErrVersionConflict},
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
	// The shared parser treats a catalog tag as foreign to the pipeline too.
	if err := pipelineconfig.CheckIfMatch(pipelineconfig.ETag(id, 0), tag, true); !errors.Is(err, drafts.ErrVersionConflict) {
		t.Fatalf("pipeline accepted catalog tag: %v", err)
	}
}
