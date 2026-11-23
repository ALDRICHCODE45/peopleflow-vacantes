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
	e := uploadedEvent(company, actor, draft, doc, version, documents.XLSX)
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
	e := downloadedEvent(company, actor, draft, doc, version, 3)
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
	a := uploadedEvent(id, id, id, id, id, documents.PDF)
	b := uploadedEvent(id, id, id, id, id, documents.PDF)
	if a.ID == b.ID {
		t.Fatal("two events must never share an id")
	}
}
