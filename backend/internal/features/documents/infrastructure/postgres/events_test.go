package postgres

import (
	"reflect"
	"testing"

	audit "github.com/aldrichcode45/peopleflow-vacantes/internal/features/audit_events/domain/entities"
	documents "github.com/aldrichcode45/peopleflow-vacantes/internal/features/documents/application"
	"github.com/google/uuid"
)

// The audit rows of the upload and the download (contract «Audit events»): ids and enums only, never a file name, and
// every key inside the catalog's closed set (Append would refuse the row otherwise).
func TestUploadedEvent(t *testing.T) {
	company, actor, draft, doc, version := uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New()
	e := uploadedEvent(company, actor, documents.VacancyTarget(draft), doc, version, documents.XLSX)
	if err := e.Validate(); err != nil {
		t.Fatalf("catalog refuses the event: %v", err)
	}
	want := map[string]string{
		"company_id": company.String(), "vacancy_id": draft.String(), "scope": "vacancy",
		"document_id": doc.String(), "version_id": version.String(), "version": "1", "format": "xlsx",
	}
	if !reflect.DeepEqual(e.Metadata, want) {
		t.Fatalf("metadata %v", e.Metadata)
	}
	if e.EventType != audit.EventDocumentUploaded || e.EntityType != audit.EntityDocument || e.EntityID != doc ||
		e.ActorType != audit.ActorTypeUser || e.ActorID == nil || *e.ActorID != actor ||
		e.CompanyID == nil || *e.CompanyID != company || e.VacancyID == nil || *e.VacancyID != draft || e.ID == uuid.Nil {
		t.Fatalf("event %+v", e)
	}
	// A vacancy document has no participation id key at all (the contract lists it for the participation scope only).
	if _, has := e.Metadata["participation_id"]; has {
		t.Fatal("participation_id on a vacancy document")
	}
}

func TestDownloadedEvent(t *testing.T) {
	company, actor, draft, doc, version := uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New()
	e := downloadedEvent(company, actor, documents.VacancyTarget(draft), doc, version, 3)
	if err := e.Validate(); err != nil {
		t.Fatalf("catalog refuses the event: %v", err)
	}
	want := map[string]string{
		"company_id": company.String(), "vacancy_id": draft.String(), "scope": "vacancy",
		"document_id": doc.String(), "version_id": version.String(), "version": "3",
	}
	if !reflect.DeepEqual(e.Metadata, want) {
		t.Fatalf("metadata %v", e.Metadata)
	}
	if e.EventType != audit.EventDocumentDownloaded || e.EntityType != audit.EntityDocument || e.EntityID != doc ||
		e.VacancyID == nil || *e.VacancyID != draft || e.CompanyID == nil || *e.CompanyID != company || e.ActorID == nil || *e.ActorID != actor {
		t.Fatalf("event %+v", e)
	}
}

func TestEventsAreUniquelyIdentified(t *testing.T) {
	id := uuid.New()
	a := uploadedEvent(id, id, documents.VacancyTarget(id), id, id, documents.PDF)
	b := uploadedEvent(id, id, documents.VacancyTarget(id), id, id, documents.PDF)
	if a.ID == b.ID {
		t.Fatal("two events must never share an id")
	}
}

// DocumentReplaced: ids and enums only; a vacancy document has no participation_id key; renamed says whether the name
// changed, never what it became.
func TestReplacedEvent(t *testing.T) {
	company, actor, draft, doc, version, previous := uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New()
	for _, renamed := range []bool{true, false} {
		e := replacedEvent(company, actor, documents.VacancyTarget(draft), doc, version, previous, 3, documents.DOCX, renamed)
		if err := e.Validate(); err != nil {
			t.Fatalf("catalog refuses the event: %v", err)
		}
		want := map[string]string{
			"company_id": company.String(), "vacancy_id": draft.String(), "scope": "vacancy",
			"document_id": doc.String(), "version_id": version.String(), "version": "3",
			"previous_version_id": previous.String(), "format": "docx", "renamed": map[bool]string{true: "true", false: "false"}[renamed],
		}
		if !reflect.DeepEqual(e.Metadata, want) {
			t.Fatalf("metadata %v", e.Metadata)
		}
		if e.EventType != audit.EventDocumentReplaced || e.EntityType != audit.EntityDocument || e.EntityID != doc ||
			e.VacancyID == nil || *e.VacancyID != draft || e.CompanyID == nil || *e.CompanyID != company || e.ActorID == nil || *e.ActorID != actor {
			t.Fatalf("event %+v", e)
		}
	}
}

// DocumentDeleted for a file: the document id is the entity id; version_count and linked_count are numbers, never names.
func TestDeletedFileEvent(t *testing.T) {
	company, actor, draft, doc := uuid.New(), uuid.New(), uuid.New(), uuid.New()
	e := deletedFileEvent(company, actor, documents.VacancyTarget(draft), doc, 4, 2)
	if err := e.Validate(); err != nil {
		t.Fatalf("catalog refuses the event: %v", err)
	}
	want := map[string]string{
		"company_id": company.String(), "vacancy_id": draft.String(), "scope": "vacancy", "kind": "file",
		"document_id": doc.String(), "version_count": "4", "linked_count": "2",
	}
	if !reflect.DeepEqual(e.Metadata, want) {
		t.Fatalf("metadata %v", e.Metadata)
	}
	if e.EventType != audit.EventDocumentDeleted || e.EntityType != audit.EntityDocument || e.EntityID != doc ||
		e.VacancyID == nil || *e.VacancyID != draft || e.CompanyID == nil || *e.CompanyID != company || e.ActorID == nil || *e.ActorID != actor {
		t.Fatalf("event %+v", e)
	}
	if _, has := e.Metadata["link_id"]; has {
		t.Fatal("link_id belongs to the link delete (P7)")
	}
}

// P6: a participation document's events carry scope=participation and the participation id (contract «Audit events»), keep the
// vacancy of the request as the event's vacancy, and stay inside the catalog's closed key set (Validate refuses anything else).
func TestParticipationDocumentEventsCarryTheParticipation(t *testing.T) {
	company, actor, draft, pid, doc, version, previous := uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New()
	target := documents.ParticipationTarget(draft, pid)
	base := map[string]string{
		"company_id": company.String(), "vacancy_id": draft.String(), "scope": "participation", "participation_id": pid.String(),
		"document_id": doc.String(),
	}
	with := func(extra map[string]string) map[string]string {
		out := map[string]string{}
		for k, v := range base {
			out[k] = v
		}
		for k, v := range extra {
			out[k] = v
		}
		return out
	}
	for name, tc := range map[string]struct {
		event audit.AuditEvent
		eType string
		want  map[string]string
	}{
		"uploaded": {uploadedEvent(company, actor, target, doc, version, documents.PNG), audit.EventDocumentUploaded,
			with(map[string]string{"version_id": version.String(), "version": "1", "format": "png"})},
		"downloaded": {downloadedEvent(company, actor, target, doc, version, 2), audit.EventDocumentDownloaded,
			with(map[string]string{"version_id": version.String(), "version": "2"})},
		"replaced": {replacedEvent(company, actor, target, doc, version, previous, 2, documents.JPG, true), audit.EventDocumentReplaced,
			with(map[string]string{"version_id": version.String(), "version": "2", "previous_version_id": previous.String(), "format": "jpg", "renamed": "true"})},
		"deleted": {deletedFileEvent(company, actor, target, doc, 3, 0), audit.EventDocumentDeleted,
			with(map[string]string{"kind": "file", "version_count": "3", "linked_count": "0"})},
	} {
		if err := tc.event.Validate(); err != nil {
			t.Fatalf("%s: catalog refuses the event: %v", name, err)
		}
		if !reflect.DeepEqual(tc.event.Metadata, tc.want) {
			t.Fatalf("%s: metadata %v", name, tc.event.Metadata)
		}
		if tc.event.EventType != tc.eType || tc.event.EntityType != audit.EntityDocument || tc.event.EntityID != doc ||
			tc.event.VacancyID == nil || *tc.event.VacancyID != draft || tc.event.CompanyID == nil || *tc.event.CompanyID != company {
			t.Fatalf("%s: event %+v", name, tc.event)
		}
	}
}
