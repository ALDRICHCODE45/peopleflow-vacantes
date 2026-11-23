package postgres

import (
	"strconv"

	audit "github.com/aldrichcode45/peopleflow-vacantes/internal/features/audit_events/domain/entities"
	documents "github.com/aldrichcode45/peopleflow-vacantes/internal/features/documents/application"
	"github.com/google/uuid"
)

// documentEvent is the common shape of the document audit rows: entity type `document`, the document id as entity id,
// the vacancy of the request. Metadata is ids and enums only: a file name may be a person's name and never goes in.
// It adds the keys every document event shares: the company, the vacancy, the scope and, for a participation document,
// the participation id (contract «Audit events»; a vacancy document has no participation_id key at all).
func documentEvent(eventType string, company, actor uuid.UUID, target documents.Target, doc uuid.UUID, metadata map[string]string) audit.AuditEvent {
	draft := target.DraftID
	metadata["company_id"] = company.String()
	metadata["vacancy_id"] = draft.String()
	metadata["scope"] = string(target.Kind())
	if target.ParticipationID != nil {
		metadata["participation_id"] = target.ParticipationID.String()
	}
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

// uploadedEvent is DocumentUploaded: version 1 of a new document of the scope of target (the replay of an upload emits none).
func uploadedEvent(company, actor uuid.UUID, target documents.Target, doc, version uuid.UUID, format documents.Format) audit.AuditEvent {
	return documentEvent(audit.EventDocumentUploaded, company, actor, target, doc, map[string]string{
		"document_id": doc.String(),
		"version_id":  version.String(),
		"version":     "1",
		"format":      string(format),
	})
}

// downloadedEvent is DocumentDownloaded (a sensitive read) for a version of a document of the scope of target.
func downloadedEvent(company, actor uuid.UUID, target documents.Target, doc, version uuid.UUID, number int) audit.AuditEvent {
	return documentEvent(audit.EventDocumentDownloaded, company, actor, target, doc, map[string]string{
		"document_id": doc.String(),
		"version_id":  version.String(),
		"version":     strconv.Itoa(number),
	})
}

// replacedEvent is DocumentReplaced: version n+1 of an existing document. `renamed` says whether the
// name changed, never what it became (a name may be a person's name and stays out of the audit trail).
func replacedEvent(company, actor uuid.UUID, target documents.Target, doc, version, previous uuid.UUID, number int, format documents.Format, renamed bool) audit.AuditEvent {
	return documentEvent(audit.EventDocumentReplaced, company, actor, target, doc, map[string]string{
		"document_id":         doc.String(),
		"version_id":          version.String(),
		"version":             strconv.Itoa(number),
		"previous_version_id": previous.String(),
		"format":              string(format),
		"renamed":             strconv.FormatBool(renamed),
	})
}

// deletedFileEvent is DocumentDeleted (kind file): the whole document with its versions. The audit row
// is the permanent record, so it carries ids and counts only: how many versions went and how many links lost their source.
func deletedFileEvent(company, actor uuid.UUID, target documents.Target, doc uuid.UUID, versionCount, linkedCount int) audit.AuditEvent {
	return documentEvent(audit.EventDocumentDeleted, company, actor, target, doc, map[string]string{
		"kind":          "file",
		"document_id":   doc.String(),
		"version_count": strconv.Itoa(versionCount),
		"linked_count":  strconv.Itoa(linkedCount),
	})
}

// linkedEvent is DocumentLinked: a link of the scope of target to a pinned version of a source document. The entity is the link;
// the source is named by ids only (document, version, vacancy and, when the source is a participation document, its
// participation), never by file name.
func linkedEvent(company, actor uuid.UUID, target documents.Target, link, sourceDoc, sourceVersion, sourceDraft uuid.UUID, sourceParticipation *uuid.UUID) audit.AuditEvent {
	metadata := map[string]string{
		"link_id":            link.String(),
		"source_document_id": sourceDoc.String(),
		"source_version_id":  sourceVersion.String(),
		"source_vacancy_id":  sourceDraft.String(),
	}
	if sourceParticipation != nil {
		metadata["source_participation_id"] = sourceParticipation.String()
	}
	return documentEvent(audit.EventDocumentLinked, company, actor, target, link, metadata)
}

// deletedLinkEvent is DocumentDeleted with kind link: the link is the entity and the only id named; the source is untouched.
func deletedLinkEvent(company, actor uuid.UUID, target documents.Target, link uuid.UUID) audit.AuditEvent {
	return documentEvent(audit.EventDocumentDeleted, company, actor, target, link, map[string]string{
		"kind":    "link",
		"link_id": link.String(),
	})
}

// downloadedViaLinkEvent is DocumentDownloaded for the pinned version served through a link: the document and version are the
// SOURCE's (the entity is the source document) and link_id says which link the bytes came through; the vacancy is the one the
// request ran against.
func downloadedViaLinkEvent(company, actor uuid.UUID, target documents.Target, link, sourceDoc, sourceVersion uuid.UUID, number int) audit.AuditEvent {
	return documentEvent(audit.EventDocumentDownloaded, company, actor, target, sourceDoc, map[string]string{
		"document_id": sourceDoc.String(),
		"version_id":  sourceVersion.String(),
		"version":     strconv.Itoa(number),
		"link_id":     link.String(),
	})
}
