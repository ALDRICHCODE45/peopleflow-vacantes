package postgres

import (
	"reflect"
	"testing"

	audit "github.com/aldrichcode45/peopleflow-vacantes/internal/features/audit_events/domain/entities"
	documents "github.com/aldrichcode45/peopleflow-vacantes/internal/features/documents/application"
	"github.com/google/uuid"
)

// The three link events (contract «Audit events»): ids and enums only, inside the catalog's closed key sets (Validate refuses
// anything else), the vacancy of the request as the event's vacancy.

func TestLinkedEventVacancyScope(t *testing.T) {
	company, actor, draft, link, srcDoc, srcVersion, srcDraft := uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New()
	e := linkedEvent(company, actor, documents.VacancyTarget(draft), link, srcDoc, srcVersion, srcDraft, nil)
	if err := e.Validate(); err != nil {
		t.Fatalf("catalog refuses the event: %v", err)
	}
	want := map[string]string{
		"company_id": company.String(), "vacancy_id": draft.String(), "scope": "vacancy", "link_id": link.String(),
		"source_document_id": srcDoc.String(), "source_version_id": srcVersion.String(), "source_vacancy_id": srcDraft.String(),
	}
	if !reflect.DeepEqual(e.Metadata, want) {
		t.Fatalf("metadata %v", e.Metadata)
	}
	if e.EventType != audit.EventDocumentLinked || e.EntityType != audit.EntityDocument || e.EntityID != link ||
		e.VacancyID == nil || *e.VacancyID != draft || e.CompanyID == nil || *e.CompanyID != company || e.ActorID == nil || *e.ActorID != actor {
		t.Fatalf("event %+v", e)
	}
}

func TestLinkedEventParticipationScopeNamesTheSourceParticipation(t *testing.T) {
	company, actor, draft, pid, link, srcDoc, srcVersion, srcDraft, srcPid := uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New()
	e := linkedEvent(company, actor, documents.ParticipationTarget(draft, pid), link, srcDoc, srcVersion, srcDraft, &srcPid)
	if err := e.Validate(); err != nil {
		t.Fatalf("catalog refuses the event: %v", err)
	}
	if e.Metadata["scope"] != "participation" || e.Metadata["participation_id"] != pid.String() || e.Metadata["source_participation_id"] != srcPid.String() ||
		e.Metadata["source_vacancy_id"] != srcDraft.String() {
		t.Fatalf("metadata %v", e.Metadata)
	}
}

func TestUnlinkedEventIsADocumentDeletedOfKindLink(t *testing.T) {
	company, actor, draft, pid, link := uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New()
	for name, tc := range map[string]struct {
		target documents.Target
		want   map[string]string
	}{
		"vacancy":       {documents.VacancyTarget(draft), map[string]string{"scope": "vacancy"}},
		"participation": {documents.ParticipationTarget(draft, pid), map[string]string{"scope": "participation", "participation_id": pid.String()}},
	} {
		e := deletedLinkEvent(company, actor, tc.target, link)
		if err := e.Validate(); err != nil {
			t.Fatalf("%s: catalog refuses the event: %v", name, err)
		}
		want := map[string]string{"company_id": company.String(), "vacancy_id": draft.String(), "kind": "link", "link_id": link.String()}
		for k, v := range tc.want {
			want[k] = v
		}
		if !reflect.DeepEqual(e.Metadata, want) {
			t.Fatalf("%s: metadata %v", name, e.Metadata)
		}
		if e.EventType != audit.EventDocumentDeleted || e.EntityType != audit.EntityDocument || e.EntityID != link {
			t.Fatalf("%s: event %+v", name, e)
		}
		if _, has := e.Metadata["document_id"]; has {
			t.Fatalf("%s: a link delete names no document", name)
		}
	}
}

// A download through a link names the SOURCE document and version (the entity is the source document) and adds the link id.
func TestLinkDownloadEventNamesTheSourceAndTheLink(t *testing.T) {
	company, actor, draft, link, srcDoc, srcVersion := uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New()
	e := downloadedViaLinkEvent(company, actor, documents.VacancyTarget(draft), link, srcDoc, srcVersion, 2)
	if err := e.Validate(); err != nil {
		t.Fatalf("catalog refuses the event: %v", err)
	}
	want := map[string]string{
		"company_id": company.String(), "vacancy_id": draft.String(), "scope": "vacancy", "document_id": srcDoc.String(),
		"version_id": srcVersion.String(), "version": "2", "link_id": link.String(),
	}
	if !reflect.DeepEqual(e.Metadata, want) {
		t.Fatalf("metadata %v", e.Metadata)
	}
	if e.EventType != audit.EventDocumentDownloaded || e.EntityType != audit.EntityDocument || e.EntityID != srcDoc || e.VacancyID == nil || *e.VacancyID != draft {
		t.Fatalf("event %+v", e)
	}
}
