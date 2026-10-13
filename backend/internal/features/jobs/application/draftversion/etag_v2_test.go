package draftversion_test

import (
	"errors"
	"math"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/draftversion"
)

// This file pins the additive r2 ETag contract. It was authored before
// FormatETagV2 / ParseIfMatchV2 were implemented: the r2 tag is exactly
// `"jd-r2-<lowercaseUUID36>-v<positiveDecimal>"`, the r2 parser accepts only
// the `jd-r2` marker, and every malformed present value maps to
// ErrInvalidRequest while a missing header maps to ErrPreconditionRequired.
// The r1 API is exercised here only to prove it did not change and never
// accepts an r2 tag.

const (
	validETagV2 = `"jd-r2-` + validID + `-v1"`
	maxETagV2   = `"jd-r2-` + validID + `-v` + maxVer + `"`
)

func TestFormatETagV2(t *testing.T) {
	tests := []struct {
		name    string
		id      string
		version int64
		want    string
		wantErr error
	}{
		{name: "version one", id: validID, version: 1, want: validETagV2},
		{name: "version forty two", id: validID, version: 42, want: `"jd-r2-` + validID + `-v42"`},
		{name: "max int64", id: validID, version: math.MaxInt64, want: maxETagV2},
		{name: "other id", id: otherID, version: 1, want: `"jd-r2-` + otherID + `-v1"`},

		{name: "empty id", id: "", version: 1, wantErr: draftversion.ErrInvalidID},
		{name: "uppercase id", id: "3F9A1C2E-5B6D-4E7F-8A9B-0C1D2E3F4A5B", version: 1, wantErr: draftversion.ErrInvalidID},
		{name: "uuid braces", id: "{3f9a1c2e-5b6d-4e7f-8a9b-0c1d2e3f4a5b}", version: 1, wantErr: draftversion.ErrInvalidID},
		{name: "uuid wrong length", id: "3f9a1c2e-5b6d-4e7f-8a9b-0c1d2e3f4a5", version: 1, wantErr: draftversion.ErrInvalidID},

		{name: "version zero", id: validID, version: 0, wantErr: draftversion.ErrInvalidVersion},
		{name: "version negative", id: validID, version: -1, wantErr: draftversion.ErrInvalidVersion},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := draftversion.FormatETagV2(tt.id, tt.version)
			if !errors.Is(err, tt.wantErr) {
				t.Fatalf("FormatETagV2(%q, %d) error = %v, want %v", tt.id, tt.version, err, tt.wantErr)
			}
			if got != tt.want {
				t.Fatalf("FormatETagV2(%q, %d) = %q, want %q", tt.id, tt.version, got, tt.want)
			}
		})
	}
}

func TestParseIfMatchV2(t *testing.T) {
	zero := draftversion.Tag{}
	tests := []struct {
		name    string
		value   string
		present bool
		want    draftversion.Tag
		wantErr error
	}{
		{name: "valid", value: validETagV2, present: true, want: draftversion.Tag{ID: validID, Version: 1}},
		{name: "valid max int64", value: maxETagV2, present: true, want: draftversion.Tag{ID: validID, Version: math.MaxInt64}},
		{name: "surrounding spaces", value: "  " + validETagV2 + "  ", present: true, want: draftversion.Tag{ID: validID, Version: 1}},
		{name: "surrounding tabs", value: "\t" + validETagV2 + "\t", present: true, want: draftversion.Tag{ID: validID, Version: 1}},
		{name: "mixed space and tab OWS", value: " \t" + validETagV2 + "\t ", present: true, want: draftversion.Tag{ID: validID, Version: 1}},

		{name: "missing", value: "", present: false, want: zero, wantErr: draftversion.ErrPreconditionRequired},
		{name: "present but empty", value: "", present: true, want: zero, wantErr: draftversion.ErrInvalidRequest},

		{name: "star", value: "*", present: true, want: zero, wantErr: draftversion.ErrInvalidRequest},
		{name: "weak", value: `W/` + validETagV2, present: true, want: zero, wantErr: draftversion.ErrInvalidRequest},
		{name: "list", value: validETagV2 + ", " + `"jd-r2-` + otherID + `-v1"`, present: true, want: zero, wantErr: draftversion.ErrInvalidRequest},
		{name: "unquoted", value: `jd-r2-` + validID + `-v1`, present: true, want: zero, wantErr: draftversion.ErrInvalidRequest},

		{name: "r1 marker rejected", value: `"jd-r1-` + validID + `-v1"`, present: true, want: zero, wantErr: draftversion.ErrInvalidRequest},
		{name: "unknown marker rejected", value: `"jd-r3-` + validID + `-v1"`, present: true, want: zero, wantErr: draftversion.ErrInvalidRequest},
		{name: "uppercase r2 marker rejected", value: `"JD-R2-` + validID + `-v1"`, present: true, want: zero, wantErr: draftversion.ErrInvalidRequest},

		{name: "uppercase uuid", value: `"jd-r2-3F9A1C2E-5B6D-4E7F-8A9B-0C1D2E3F4A5B-v1"`, present: true, want: zero, wantErr: draftversion.ErrInvalidRequest},
		{name: "uuid without hyphens", value: `"jd-r2-3f9a1c2e5b6d4e7f8a9b0c1d2e3f4a5b-v1"`, present: true, want: zero, wantErr: draftversion.ErrInvalidRequest},
		{name: "uuid non hex", value: `"jd-r2-3f9a1c2e-5b6d-4e7f-8a9b-0c1d2e3f4a5g-v1"`, present: true, want: zero, wantErr: draftversion.ErrInvalidRequest},

		{name: "version zero", value: `"jd-r2-` + validID + `-v0"`, present: true, want: zero, wantErr: draftversion.ErrInvalidRequest},
		{name: "version negative", value: `"jd-r2-` + validID + `-v-1"`, present: true, want: zero, wantErr: draftversion.ErrInvalidRequest},
		{name: "version plus", value: `"jd-r2-` + validID + `-v+1"`, present: true, want: zero, wantErr: draftversion.ErrInvalidRequest},
		{name: "version leading zero", value: `"jd-r2-` + validID + `-v01"`, present: true, want: zero, wantErr: draftversion.ErrInvalidRequest},
		{name: "version fraction", value: `"jd-r2-` + validID + `-v1.0"`, present: true, want: zero, wantErr: draftversion.ErrInvalidRequest},
		{name: "version exponent", value: `"jd-r2-` + validID + `-v1e2"`, present: true, want: zero, wantErr: draftversion.ErrInvalidRequest},
		{name: "version overflow", value: `"jd-r2-` + validID + `-v9223372036854775808"`, present: true, want: zero, wantErr: draftversion.ErrInvalidRequest},

		{name: "non HTTP whitespace newline", value: "\n" + validETagV2, present: true, want: zero, wantErr: draftversion.ErrInvalidRequest},
		{name: "non HTTP whitespace carriage return", value: validETagV2 + "\r", present: true, want: zero, wantErr: draftversion.ErrInvalidRequest},
		{name: "non HTTP whitespace vertical tab", value: "\v" + validETagV2 + "\v", present: true, want: zero, wantErr: draftversion.ErrInvalidRequest},
		{name: "non HTTP whitespace form feed", value: "\f" + validETagV2, present: true, want: zero, wantErr: draftversion.ErrInvalidRequest},
		{name: "non HTTP whitespace unicode nbsp", value: "\u00a0" + validETagV2 + "\u00a0", present: true, want: zero, wantErr: draftversion.ErrInvalidRequest},
		{name: "inner space not OWS", value: `"jd-r2-` + validID + `-v1 "`, present: true, want: zero, wantErr: draftversion.ErrInvalidRequest},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := draftversion.ParseIfMatchV2(tt.value, tt.present)
			if !errors.Is(err, tt.wantErr) {
				t.Fatalf("ParseIfMatchV2(%q, %v) error = %v, want %v", tt.value, tt.present, err, tt.wantErr)
			}
			if got != tt.want {
				t.Fatalf("ParseIfMatchV2(%q, %v) = %+v, want %+v", tt.value, tt.present, got, tt.want)
			}
		})
	}
}

func TestFormatParseCompareV2RoundTrip(t *testing.T) {
	issued, err := draftversion.FormatETagV2(validID, 7)
	if err != nil {
		t.Fatalf("FormatETagV2() error = %v", err)
	}
	presented, err := draftversion.ParseIfMatchV2(issued, true)
	if err != nil {
		t.Fatalf("ParseIfMatchV2() error = %v", err)
	}
	if err := draftversion.Compare(draftversion.Tag{ID: validID, Version: 7}, presented); err != nil {
		t.Fatalf("Compare() error = %v", err)
	}

	stale, err := draftversion.FormatETagV2(validID, 6)
	if err != nil {
		t.Fatalf("FormatETagV2(stale) error = %v", err)
	}
	staleTag, err := draftversion.ParseIfMatchV2(stale, true)
	if err != nil {
		t.Fatalf("ParseIfMatchV2(stale) error = %v", err)
	}
	if err := draftversion.Compare(draftversion.Tag{ID: validID, Version: 7}, staleTag); !errors.Is(err, draftversion.ErrVersionConflict) {
		t.Fatalf("Compare(stale) error = %v, want %v", err, draftversion.ErrVersionConflict)
	}

	other, err := draftversion.FormatETagV2(otherID, 7)
	if err != nil {
		t.Fatalf("FormatETagV2(other) error = %v", err)
	}
	otherTag, err := draftversion.ParseIfMatchV2(other, true)
	if err != nil {
		t.Fatalf("ParseIfMatchV2(other) error = %v", err)
	}
	if err := draftversion.Compare(draftversion.Tag{ID: validID, Version: 7}, otherTag); !errors.Is(err, draftversion.ErrVersionConflict) {
		t.Fatalf("Compare(other id) error = %v, want %v", err, draftversion.ErrVersionConflict)
	}
}

// TestV1UnchangedAndRejectsV2 guards the r1 contract the additive r2 work must
// not touch: the r1 formatter still emits `jd-r1`, the r1 parser still accepts
// it and the r1 parser never accepts an r2 tag.
func TestV1UnchangedAndRejectsV2(t *testing.T) {
	formatted, err := draftversion.FormatETag(validID, 1)
	if err != nil {
		t.Fatalf("FormatETag() error = %v", err)
	}
	if formatted != validETag {
		t.Fatalf("FormatETag() = %q, want %q", formatted, validETag)
	}

	parsed, err := draftversion.ParseIfMatch(validETag, true)
	if err != nil {
		t.Fatalf("ParseIfMatch(r1) error = %v", err)
	}
	if parsed != (draftversion.Tag{ID: validID, Version: 1}) {
		t.Fatalf("ParseIfMatch(r1) = %+v, want {ID: %s Version: 1}", parsed, validID)
	}

	if _, err := draftversion.ParseIfMatch(validETagV2, true); !errors.Is(err, draftversion.ErrInvalidRequest) {
		t.Fatalf("ParseIfMatch(r2) error = %v, want %v", err, draftversion.ErrInvalidRequest)
	}
}
