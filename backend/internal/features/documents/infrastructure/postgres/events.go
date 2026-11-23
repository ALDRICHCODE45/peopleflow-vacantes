package postgres

import (
	"strconv"

	audit "github.com/aldrichcode45/peopleflow-vacantes/internal/features/audit_events/domain/entities"
	documents "github.com/aldrichcode45/peopleflow-vacantes/internal/features/documents/application"
	"github.com/google/uuid"
)

// documentEvent is the common shape of the document audit rows: entity type `document`, the document id as entity id,
// the vacancy of the request. Metadata is ids and enums only: a file name may be a person's name and never goes in.
func documentEvent(eventType string, company, actor, draft, doc uuid.UUID, metadata map[string]string) audit.AuditEvent {
	return audit.AuditEvent{
		ID:         uuid.Must(uuid.NewV7()),
		ActorType:  audit.ActorTypeUser,
		ActorID:    &actor,
		EventType:  eventType,
		EntityType: audit.EntityDocument,
		EntityID:   doc,
		CompanyID:  &company,
		VacancyID:  &draft,
		Metadata:   metadata,
	}
}

// uploadedEvent is DocumentUploaded for a vacancy document: version 1 of a new document (the replay of an upload emits
// none). `participation_id` is a participation-scope key and is absent here.
func uploadedEvent(company, actor, draft, doc, version uuid.UUID, format documents.Format) audit.AuditEvent {
	return documentEvent(audit.EventDocumentUploaded, company, actor, draft, doc, map[string]string{
		"company_id":  company.String(),
		"vacancy_id":  draft.String(),
		"scope":       string(documents.ScopeVacancy),
		"document_id": doc.String(),
		"version_id":  version.String(),
		"version":     "1",
		"format":      string(format),
	})
}

// downloadedEvent is DocumentDownloaded (a sensitive read) for a vacancy document's version.
func downloadedEvent(company, actor, draft, doc, version uuid.UUID, number int) audit.AuditEvent {
	return documentEvent(audit.EventDocumentDownloaded, company, actor, draft, doc, map[string]string{
		"company_id":  company.String(),
		"vacancy_id":  draft.String(),
		"scope":       string(documents.ScopeVacancy),
		"document_id": doc.String(),
		"version_id":  version.String(),
		"version":     strconv.Itoa(number),
	})
}

// replacedEvent is DocumentReplaced for a vacancy document: version n+1 of an existing document. `renamed` says whether the
// name changed, never what it became (a name may be a person's name and stays out of the audit trail).
func replacedEvent(company, actor, draft, doc, version, previous uuid.UUID, number int, format documents.Format, renamed bool) audit.AuditEvent {
	return documentEvent(audit.EventDocumentReplaced, company, actor, draft, doc, map[string]string{
		"company_id":          company.String(),
		"vacancy_id":          draft.String(),
		"scope":               string(documents.ScopeVacancy),
		"document_id":         doc.String(),
		"version_id":          version.String(),
		"version":             strconv.Itoa(number),
		"previous_version_id": previous.String(),
		"format":              string(format),
		"renamed":             strconv.FormatBool(renamed),
	})
}

// deletedFileEvent is DocumentDeleted (kind file) for a vacancy document: the whole document with its versions. The audit row
// is the permanent record, so it carries ids and counts only: how many versions went and how many links lost their source.
func deletedFileEvent(company, actor, draft, doc uuid.UUID, versionCount, linkedCount int) audit.AuditEvent {
	return documentEvent(audit.EventDocumentDeleted, company, actor, draft, doc, map[string]string{
		"company_id":    company.String(),
		"vacancy_id":    draft.String(),
		"scope":         string(documents.ScopeVacancy),
		"kind":          "file",
		"document_id":   doc.String(),
		"version_count": strconv.Itoa(versionCount),
		"linked_count":  strconv.Itoa(linkedCount),
	})
}
