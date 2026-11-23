package postgres

import (
	"reflect"
	"testing"
	"time"

	documents "github.com/aldrichcode45/peopleflow-vacantes/internal/features/documents/application"
)

var (
	t0 = time.Date(2026, 11, 20, 15, 2, 11, 482910000, time.UTC)
	t1 = time.Date(2026, 11, 22, 9, 40, 3, 100200000, time.UTC)
)

func sampleItemRow() itemRow {
	return itemRow{
		id: "d1", name: "Contrato marco", createdAt: t0, createdBy: person("u1", "Ana López"),
		version: 2, versionCount: 2, contentType: "application/pdf", size: 183204, uploadedAt: t1, uploadedBy: person("u2", "Luis Ortega"),
	}
}

func person(id, name string) documents.Person { return documents.Person{ID: id, Name: name} }

func TestNewItemMapsTheCurrentVersion(t *testing.T) {
	item, err := newItem(sampleItemRow(), true)
	if err != nil {
		t.Fatal(err)
	}
	want := documents.Item{
		ID: "d1", ParticipationID: nil, Name: "Contrato marco", Format: documents.PDF, ContentType: "application/pdf", Size: 183204,
		Version: 2, VersionCount: 2, CreatedAt: "2026-11-20T15:02:11.482910Z", CreatedBy: person("u1", "Ana López"),
		UpdatedAt: "2026-11-22T09:40:03.100200Z", UpdatedBy: person("u2", "Luis Ortega"),
		AllowedActions: []documents.Action{documents.ActionDownload, documents.ActionReplace, documents.ActionDelete},
	}
	if !reflect.DeepEqual(item, want) {
		t.Fatalf("got  %+v\nwant %+v", item, want)
	}
}

func TestNewItemActionsFollowTheCallerAndTheVersionCount(t *testing.T) {
	row := sampleItemRow()
	row.versionCount = documents.MaxVersions
	atCap, _ := newItem(row, true)
	if !reflect.DeepEqual(atCap.AllowedActions, []documents.Action{documents.ActionDownload, documents.ActionDelete}) {
		t.Fatalf("at the version cap: %v", atCap.AllowedActions)
	}
	reader, _ := newItem(sampleItemRow(), false)
	if !reflect.DeepEqual(reader.AllowedActions, []documents.Action{documents.ActionDownload}) {
		t.Fatalf("read-only caller: %v", reader.AllowedActions)
	}
}

func TestNewItemFailsClosedOnAFormatOutsideTheEnum(t *testing.T) {
	row := sampleItemRow()
	row.contentType = "application/msword"
	if _, err := newItem(row, true); err == nil {
		t.Fatal("a content type outside the closed format enum must not reach the frontend")
	}
}

func sampleLinkRow() linkRow {
	doc, process, name := "src", "proc0", "Contrato original"
	version, count, newest, sequence := int32(1), int32(3), int32(3), int32(0)
	size, uploadedAt := int64(91200), t0
	uploader := person("u1", "Ana López")
	return linkRow{
		id: "l1", linkedAt: t1, linkedBy: person("u3", "Eva Ríos"),
		sourceDocumentID: &doc, sourceProcessID: &process, sourceName: &name, sourceContentType: strPtr("application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
		pinnedVersion: &version, size: &size, uploadedAt: &uploadedAt, uploadedBy: &uploader, versionCount: &count, newestVersion: &newest, sequence: &sequence,
		readable: true,
	}
}

func strPtr(s string) *string { return &s }

func TestNewLinkAvailableDescribesThePinnedVersion(t *testing.T) {
	link, err := newLink(sampleLinkRow(), true)
	if err != nil {
		t.Fatal(err)
	}
	if link.State != documents.LinkAvailable || !reflect.DeepEqual(link.AllowedActions, []documents.Action{documents.ActionDownload, documents.ActionUnlink}) {
		t.Fatalf("state/actions: %+v", link)
	}
	src := link.Source
	if src == nil {
		t.Fatal("available link without source")
	}
	// The pinned version's data, the source's current number of versions, and a newer version flag.
	if src.DocumentID != "src" || src.ProcessID != "proc0" || src.Sequence != 0 || src.ParticipationID != nil || src.Name != "Contrato original" ||
		src.Format != documents.DOCX || src.Size != 91200 || src.Version != 1 || src.VersionCount != 3 || src.UploadedAt != "2026-11-20T15:02:11.482910Z" ||
		src.UploadedBy != person("u1", "Ana López") || !src.HasNewerVersion {
		t.Fatalf("source: %+v", src)
	}
	if link.LinkedAt != "2026-11-22T09:40:03.100200Z" || link.LinkedBy != person("u3", "Eva Ríos") {
		t.Fatalf("link: %+v", link)
	}
}

func TestNewLinkStates(t *testing.T) {
	// The pinned version is the newest one: no newer-version flag.
	current := sampleLinkRow()
	pinnedNewest := int32(3)
	current.pinnedVersion = &pinnedNewest
	link, _ := newLink(current, false)
	if link.Source == nil || link.Source.HasNewerVersion || !reflect.DeepEqual(link.AllowedActions, []documents.Action{documents.ActionDownload}) {
		t.Fatalf("pinned to the newest, read-only: %+v", link)
	}

	// Source deleted: the FK columns went NULL. The link stays, as «removed», with no source.
	removed := sampleLinkRow()
	removed.sourceDocumentID, removed.pinnedVersion = nil, nil
	for _, tc := range []struct {
		canManage bool
		want      []documents.Action
	}{{true, []documents.Action{documents.ActionUnlink}}, {false, []documents.Action{}}} {
		link, err := newLink(removed, tc.canManage)
		if err != nil || link.State != documents.LinkRemoved || link.Source != nil || !reflect.DeepEqual(link.AllowedActions, tc.want) {
			t.Fatalf("removed (manage=%v): %+v %v", tc.canManage, link, err)
		}
	}

	// Source the viewer may not read: no name, size or download.
	hidden := sampleLinkRow()
	hidden.readable = false
	link, err := newLink(hidden, true)
	if err != nil || link.State != documents.LinkInaccessible || link.Source != nil || !reflect.DeepEqual(link.AllowedActions, []documents.Action{documents.ActionUnlink}) {
		t.Fatalf("inaccessible: %+v %v", link, err)
	}
	// Removed wins over unreadable: a deleted source has nothing left to hide or to read.
	both := removed
	both.readable = false
	if link, _ := newLink(both, true); link.State != documents.LinkRemoved {
		t.Fatalf("removed and unreadable = %s", link.State)
	}
}

func TestNewLinkSourceOfAParticipationDocument(t *testing.T) {
	row := sampleLinkRow()
	row.sourceParticipationID = strPtr("part-1")
	seq := int32(2)
	row.sequence = &seq
	link, err := newLink(row, true)
	if err != nil || link.Source.ParticipationID == nil || *link.Source.ParticipationID != "part-1" || link.Source.Sequence != 2 {
		t.Fatalf("%+v %v", link, err)
	}
}

func TestNewVersionItemMapsAVersionRow(t *testing.T) {
	row := versionRow{version: 2, contentType: "application/pdf", size: 183204, uploadedAt: t1, uploadedBy: person("u2", "Luis Ortega")}
	got, err := newVersionItem(row, 2)
	if err != nil {
		t.Fatal(err)
	}
	want := documents.VersionItem{Version: 2, Format: documents.PDF, ContentType: "application/pdf", Size: 183204, UploadedAt: "2026-11-22T09:40:03.100200Z", UploadedBy: person("u2", "Luis Ortega"), IsCurrent: true}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got  %+v\nwant %+v", got, want)
	}
	older, err := newVersionItem(versionRow{version: 1, contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", size: 9, uploadedAt: t0, uploadedBy: person("u1", "Ana López")}, 2)
	if err != nil || older.IsCurrent || older.Format != documents.DOCX {
		t.Fatalf("older version: %+v %v", older, err)
	}
}

func TestNewVersionItemFailsClosedOnAFormatOutsideTheEnum(t *testing.T) {
	if _, err := newVersionItem(versionRow{version: 1, contentType: "application/msword"}, 1); err == nil {
		t.Fatal("a content type outside the closed format enum must not reach the frontend")
	}
}
