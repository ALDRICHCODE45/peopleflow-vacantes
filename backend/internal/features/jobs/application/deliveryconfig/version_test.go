package deliveryconfig

import (
	"errors"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/drafts"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/draftversion"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/pipelineconfig"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/substatecatalog"
	"github.com/google/uuid"
)

func TestETag_IndependentOpaqueStrongPrecondition(t *testing.T) {
	id := uuid.New()
	tag := ETag(id, 0)
	draftTag, err := draftversion.FormatETagV2(id.String(), 1)
	if err != nil {
		t.Fatal(err)
	}
	if tag != ETag(id, 0) || tag == ETag(id, 1) || tag == ETag(uuid.New(), 0) || tag == pipelineconfig.ETag(id, 0) || tag == substatecatalog.ETag(id, 0) || tag == draftTag {
		t.Fatal("tags not independent/deterministic")
	}
	if _, err := draftversion.ParseIfMatchV2(tag, true); err == nil {
		t.Fatal("delivery tag parsed as draft tag")
	}
	for _, tc := range []struct {
		name, value string
		present     bool
		want        error
	}{
		{"issued", tag, true, nil},
		{"missing", "", false, drafts.ErrPreconditionRequired},
		{"empty", "", true, drafts.ErrInvalidRequest},
		{"weak", "W/" + tag, true, drafts.ErrInvalidRequest},
		{"list", tag + "," + tag, true, drafts.ErrInvalidRequest},
		{"wildcard", "*", true, drafts.ErrInvalidRequest},
		{"stale", ETag(id, 1), true, drafts.ErrVersionConflict},
		{"foreign draft", draftTag, true, drafts.ErrVersionConflict},
		{"foreign pipeline", pipelineconfig.ETag(id, 0), true, drafts.ErrVersionConflict},
		{"foreign substates", substatecatalog.ETag(id, 0), true, drafts.ErrVersionConflict},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if err := pipelineconfig.CheckIfMatch(tag, tc.value, tc.present); !errors.Is(err, tc.want) {
				t.Fatalf("err=%v want=%v", err, tc.want)
			}
		})
	}
}
