package draftversion_test

import (
	"errors"
	"math"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/draftversion"
)

// The expectations in this file were authored before FormatETag, ParseIfMatch
// and Compare were implemented. They describe the accepted T2 contract:
// one exact quoted strong tag `"jd-r1-<lowercaseUUID36>-v<positiveDecimal>"`,
// a missing header mapped to precondition_required, every malformed present
// header mapped to invalid_request, and id/version mismatches mapped to
// version_conflict by a compare step that runs only after authorization.

const (
	validID   = "3f9a1c2e-5b6d-4e7f-8a9b-0c1d2e3f4a5b"
	otherID   = "0c1d2e3f-4a5b-4c6d-8e7f-1a2b3c4d5e6f"
	validETag = `"jd-r1-3f9a1c2e-5b6d-4e7f-8a9b-0c1d2e3f4a5b-v1"`
	maxVer    = "9223372036854775807"
	maxETag   = `"jd-r1-3f9a1c2e-5b6d-4e7f-8a9b-0c1d2e3f4a5b-v` + maxVer + `"`
)

func TestFormatETag(t *testing.T) {
	tests := []struct {
		name    string
		id      string
		version int64
		want    string
		wantErr error
	}{
		{name: "version one", id: validID, version: 1, want: validETag},
		{name: "version forty two", id: validID, version: 42, want: `"jd-r1-3f9a1c2e-5b6d-4e7f-8a9b-0c1d2e3f4a5b-v42"`},
		{name: "max int64", id: validID, version: math.MaxInt64, want: maxETag},
		{name: "other id", id: otherID, version: 1, want: `"jd-r1-0c1d2e3f-4a5b-4c6d-8e7f-1a2b3c4d5e6f-v1"`},

		{name: "empty id", id: "", version: 1, wantErr: draftversion.ErrInvalidID},
		{name: "uppercase id", id: "3F9A1C2E-5B6D-4E7F-8A9B-0C1D2E3F4A5B", version: 1, wantErr: draftversion.ErrInvalidID},
		{name: "uuid without hyphens", id: "3f9a1c2e5b6d4e7f8a9b0c1d2e3f4a5b", version: 1, wantErr: draftversion.ErrInvalidID},
		{name: "uuid wrong length", id: "3f9a1c2e-5b6d-4e7f-8a9b-0c1d2e3f4a5", version: 1, wantErr: draftversion.ErrInvalidID},
		{name: "uuid non hex", id: "3f9a1c2e-5b6d-4e7f-8a9b-0c1d2e3f4a5g", version: 1, wantErr: draftversion.ErrInvalidID},
		{name: "uuid braces", id: "{3f9a1c2e-5b6d-4e7f-8a9b-0c1d2e3f4a5b}", version: 1, wantErr: draftversion.ErrInvalidID},

		{name: "version zero", id: validID, version: 0, wantErr: draftversion.ErrInvalidVersion},
		{name: "version negative", id: validID, version: -1, wantErr: draftversion.ErrInvalidVersion},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := draftversion.FormatETag(tt.id, tt.version)
			if !errors.Is(err, tt.wantErr) {
				t.Fatalf("FormatETag() error = %v, want %v", err, tt.wantErr)
			}
			if got != tt.want {
				t.Fatalf("FormatETag() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestParseIfMatch(t *testing.T) {
	tests := []struct {
		name    string
		value   string
		present bool
		want    draftversion.Tag
		wantErr error
	}{
		{name: "valid", value: validETag, present: true, want: draftversion.Tag{ID: validID, Version: 1}},
		{name: "valid max int64", value: maxETag, present: true, want: draftversion.Tag{ID: validID, Version: math.MaxInt64}},
		{name: "surrounding spaces", value: "  " + validETag + "  ", present: true, want: draftversion.Tag{ID: validID, Version: 1}},
		{name: "surrounding tabs", value: "\t" + validETag + "\t", present: true, want: draftversion.Tag{ID: validID, Version: 1}},

		{name: "missing", value: "", present: false, wantErr: draftversion.ErrPreconditionRequired},

		{name: "present but empty", value: "", present: true, wantErr: draftversion.ErrInvalidRequest},
		{name: "whitespace only", value: " \t ", present: true, wantErr: draftversion.ErrInvalidRequest},
		{name: "star", value: "*", present: true, wantErr: draftversion.ErrInvalidRequest},
		{name: "star with spaces", value: " * ", present: true, wantErr: draftversion.ErrInvalidRequest},
		{name: "weak", value: `W/` + validETag, present: true, wantErr: draftversion.ErrInvalidRequest},
		{name: "weak lowercase", value: `w/` + validETag, present: true, wantErr: draftversion.ErrInvalidRequest},
		{name: "list", value: validETag + ", " + `"jd-r1-` + otherID + `-v1"`, present: true, wantErr: draftversion.ErrInvalidRequest},
		{name: "two tags no comma", value: validETag + " " + `"jd-r1-` + otherID + `-v1"`, present: true, wantErr: draftversion.ErrInvalidRequest},
		{name: "unquoted", value: `jd-r1-` + validID + `-v1`, present: true, wantErr: draftversion.ErrInvalidRequest},
		{name: "empty quotes", value: `""`, present: true, wantErr: draftversion.ErrInvalidRequest},
		{name: "missing prefix", value: `"` + validID + `-v1"`, present: true, wantErr: draftversion.ErrInvalidRequest},

		{name: "uppercase scheme", value: `"JD-R1-` + validID + `-v1"`, present: true, wantErr: draftversion.ErrInvalidRequest},
		{name: "uppercase uuid", value: `"jd-r1-3F9A1C2E-5B6D-4E7F-8A9B-0C1D2E3F4A5B-v1"`, present: true, wantErr: draftversion.ErrInvalidRequest},
		{name: "uuid without hyphens", value: `"jd-r1-3f9a1c2e5b6d4e7f8a9b0c1d2e3f4a5b-v1"`, present: true, wantErr: draftversion.ErrInvalidRequest},
		{name: "uuid wrong length", value: `"jd-r1-3f9a1c2e-5b6d-4e7f-8a9b-0c1d2e3f4a5-v1"`, present: true, wantErr: draftversion.ErrInvalidRequest},
		{name: "uuid non hex", value: `"jd-r1-3f9a1c2e-5b6d-4e7f-8a9b-0c1d2e3f4a5g-v1"`, present: true, wantErr: draftversion.ErrInvalidRequest},

		{name: "version zero", value: `"jd-r1-` + validID + `-v0"`, present: true, wantErr: draftversion.ErrInvalidRequest},
		{name: "version negative", value: `"jd-r1-` + validID + `-v-1"`, present: true, wantErr: draftversion.ErrInvalidRequest},
		{name: "version plus sign", value: `"jd-r1-` + validID + `-v+1"`, present: true, wantErr: draftversion.ErrInvalidRequest},
		{name: "version leading zero", value: `"jd-r1-` + validID + `-v01"`, present: true, wantErr: draftversion.ErrInvalidRequest},
		{name: "version empty", value: `"jd-r1-` + validID + `-v"`, present: true, wantErr: draftversion.ErrInvalidRequest},
		{name: "version decimal", value: `"jd-r1-` + validID + `-v1.0"`, present: true, wantErr: draftversion.ErrInvalidRequest},
		{name: "version overflow", value: `"jd-r1-` + validID + `-v9223372036854775808"`, present: true, wantErr: draftversion.ErrInvalidRequest},
		{name: "version huge", value: `"jd-r1-` + validID + `-v99999999999999999999999999"`, present: true, wantErr: draftversion.ErrInvalidRequest},

		{name: "trailing inner space", value: `"jd-r1-` + validID + `-v1 "`, present: true, wantErr: draftversion.ErrInvalidRequest},
		{name: "leading inner space", value: `" jd-r1-` + validID + `-v1"`, present: true, wantErr: draftversion.ErrInvalidRequest},
		{name: "embedded quote", value: `"jd-r1-` + validID + `-v1""`, present: true, wantErr: draftversion.ErrInvalidRequest},
		{name: "missing opening quote", value: `jd-r1-` + validID + `-v1"`, present: true, wantErr: draftversion.ErrInvalidRequest},
		{name: "missing closing quote", value: `"jd-r1-` + validID + `-v1`, present: true, wantErr: draftversion.ErrInvalidRequest},
		{name: "trailing junk", value: validETag + "x", present: true, wantErr: draftversion.ErrInvalidRequest},
		{name: "leading junk", value: "x" + validETag, present: true, wantErr: draftversion.ErrInvalidRequest},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := draftversion.ParseIfMatch(tt.value, tt.present)
			if !errors.Is(err, tt.wantErr) {
				t.Fatalf("ParseIfMatch(%q, %v) error = %v, want %v", tt.value, tt.present, err, tt.wantErr)
			}
			if got != tt.want {
				t.Fatalf("ParseIfMatch(%q, %v) = %+v, want %+v", tt.value, tt.present, got, tt.want)
			}
		})
	}
}

func TestCompare(t *testing.T) {
	tests := []struct {
		name      string
		issued    draftversion.Tag
		presented draftversion.Tag
		wantErr   error
	}{
		{name: "equal", issued: draftversion.Tag{ID: validID, Version: 1}, presented: draftversion.Tag{ID: validID, Version: 1}},
		{name: "other id", issued: draftversion.Tag{ID: validID, Version: 1}, presented: draftversion.Tag{ID: otherID, Version: 1}, wantErr: draftversion.ErrVersionConflict},
		{name: "stale version", issued: draftversion.Tag{ID: validID, Version: 2}, presented: draftversion.Tag{ID: validID, Version: 1}, wantErr: draftversion.ErrVersionConflict},
		{name: "newer version", issued: draftversion.Tag{ID: validID, Version: 1}, presented: draftversion.Tag{ID: validID, Version: 2}, wantErr: draftversion.ErrVersionConflict},
		{name: "other id and stale", issued: draftversion.Tag{ID: validID, Version: 2}, presented: draftversion.Tag{ID: otherID, Version: 1}, wantErr: draftversion.ErrVersionConflict},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if err := draftversion.Compare(tt.issued, tt.presented); !errors.Is(err, tt.wantErr) {
				t.Fatalf("Compare() error = %v, want %v", err, tt.wantErr)
			}
		})
	}
}

func TestFormatParseCompareRoundTrip(t *testing.T) {
	issued, err := draftversion.FormatETag(validID, 7)
	if err != nil {
		t.Fatalf("FormatETag() error = %v", err)
	}
	presented, err := draftversion.ParseIfMatch(issued, true)
	if err != nil {
		t.Fatalf("ParseIfMatch() error = %v", err)
	}
	if err := draftversion.Compare(draftversion.Tag{ID: validID, Version: 7}, presented); err != nil {
		t.Fatalf("Compare() error = %v", err)
	}
	if err := draftversion.Compare(draftversion.Tag{ID: validID, Version: 8}, presented); !errors.Is(err, draftversion.ErrVersionConflict) {
		t.Fatalf("Compare() stale error = %v, want %v", err, draftversion.ErrVersionConflict)
	}
}
