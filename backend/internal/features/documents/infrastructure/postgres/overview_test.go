package postgres

import (
	"reflect"
	"testing"

	documents "github.com/aldrichcode45/peopleflow-vacantes/internal/features/documents/application"
)

func i32Ptr(n int32) *int32 { return &n }

// The header names the lifecycle exactly as GET V/lifecycle does (L20): publication/process are the stored axes, null for a draft
// that never published (no process row); an original with a process row is public, only a replacement without a public
// projection is private; kind is replacement exactly when the chain has a row.
func TestNewOverviewVacancyUsesTheLifecycleVocabulary(t *testing.T) {
	cases := []struct {
		name string
		row  vacancyRow
		want documents.OverviewVacancy
	}{
		{"never published", vacancyRow{title: strPtr("Analista")}, documents.OverviewVacancy{ID: "v", Title: strPtr("Analista"), Kind: "original"}},
		{"untitled draft", vacancyRow{}, documents.OverviewVacancy{ID: "v", Kind: "original"}},
		{"published original", vacancyRow{status: strPtr("published"), process: strPtr("active")},
			documents.OverviewVacancy{ID: "v", Publication: strPtr("published"), Process: strPtr("active"), Kind: "original", Visibility: strPtr("public")}},
		{"closed, finished original", vacancyRow{status: strPtr("closed"), process: strPtr("finished")},
			documents.OverviewVacancy{ID: "v", Publication: strPtr("closed"), Process: strPtr("finished"), Kind: "original", Visibility: strPtr("public")}},
		{"private replacement", vacancyRow{status: strPtr("paused"), process: strPtr("active"), sequence: i32Ptr(1)},
			documents.OverviewVacancy{ID: "v", Publication: strPtr("paused"), Process: strPtr("active"), Kind: "replacement", Visibility: strPtr("private")}},
		{"public replacement", vacancyRow{status: strPtr("published"), process: strPtr("active"), sequence: i32Ptr(2), hasProjection: true},
			documents.OverviewVacancy{ID: "v", Publication: strPtr("published"), Process: strPtr("active"), Kind: "replacement", Visibility: strPtr("public")}},
	}
	for _, tc := range cases {
		if got := newOverviewVacancy("v", tc.row); !reflect.DeepEqual(got, tc.want) {
			t.Errorf("%s:\n got %+v\nwant %+v", tc.name, got, tc.want)
		}
	}
}

func sampleParticipationRow() participationRow {
	return participationRow{id: "p1", candidateKind: "manual", candidateID: "c1", fullName: "Marta Ruiz", stageID: "s-place"}
}

var sampleStages = map[string]documents.Stage{
	"s-place": {Kind: "placement", Name: "Placement"},
	"s-new":   {Kind: "new", Name: "Nuevos"},
}

func TestNewOverviewParticipationNamesTheStageAndBuildsTheParticipationScope(t *testing.T) {
	row := sampleParticipationRow()
	row.carried, row.files, row.links = true, 3, 1
	got, err := newOverviewParticipation(row, sampleStages, true)
	if err != nil {
		t.Fatal(err)
	}
	want := documents.OverviewParticipation{
		ParticipationID: "p1", Candidate: documents.NamedCandidate{Kind: "manual", ID: "c1", FullName: "Marta Ruiz"},
		Stage:               documents.Stage{Kind: "placement", Name: "Placement"},
		ScopeAllowedActions: []documents.Action{documents.ActionUpload, documents.ActionLink},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got  %+v\nwant %+v", got, want)
	}

	// not carried: no link action; at the participation limit (20, files plus links): nothing, limit_reached
	row.carried = false
	if got, _ := newOverviewParticipation(row, sampleStages, true); !reflect.DeepEqual(got.ScopeAllowedActions, []documents.Action{documents.ActionUpload}) {
		t.Fatalf("not carried: %v", got.ScopeAllowedActions)
	}
	row.files, row.links = 15, 5
	full, _ := newOverviewParticipation(row, sampleStages, true)
	if len(full.ScopeAllowedActions) != 0 || full.UploadBlockedReason == nil || *full.UploadBlockedReason != documents.BlockedLimitReached {
		t.Fatalf("full scope: %v %v", full.ScopeAllowedActions, full.UploadBlockedReason)
	}
	// a caller who cannot manage gets no actions and no reason, whatever the counts
	reader, _ := newOverviewParticipation(row, sampleStages, false)
	if reader.ScopeAllowedActions == nil || len(reader.ScopeAllowedActions) != 0 || reader.UploadBlockedReason != nil {
		t.Fatalf("read-only caller: %v %v", reader.ScopeAllowedActions, reader.UploadBlockedReason)
	}
}

func TestNewOverviewParticipationKeepsDiscardedAndFailsClosedOnAnUnknownStage(t *testing.T) {
	row := sampleParticipationRow()
	row.discarded, row.stageID = true, "s-new"
	got, err := newOverviewParticipation(row, sampleStages, true)
	if err != nil || !got.Discarded || got.Stage != (documents.Stage{Kind: "new", Name: "Nuevos"}) {
		t.Fatalf("discarded: %+v %v", got, err)
	}
	row.stageID = "unknown"
	if _, err := newOverviewParticipation(row, sampleStages, true); err == nil {
		t.Fatal("a stage that is not in the pipeline must fail the read, never invent a name")
	}
}

// The cap is the contract's 2000 unless a test sets a smaller one; a non-positive value never disables it.
func TestOverviewCapDefaultsToTheContractsAndIgnoresNonPositive(t *testing.T) {
	s := &Store{}
	if documents.MaxOverviewRows != 2000 {
		t.Fatalf("the contract's cap is 2000, got %d", documents.MaxOverviewRows)
	}
	if got := s.rowCap(); got != documents.MaxOverviewRows {
		t.Fatalf("default cap %d", got)
	}
	if got := s.WithOverviewCap(5).rowCap(); got != 5 {
		t.Fatalf("custom cap %d", got)
	}
	if got := s.WithOverviewCap(0).WithOverviewCap(-3).rowCap(); got != 5 {
		t.Fatalf("a non-positive cap changed it to %d", got)
	}
}
