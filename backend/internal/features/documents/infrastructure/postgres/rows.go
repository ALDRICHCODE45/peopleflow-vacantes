package postgres

import (
	"fmt"
	"time"

	documents "github.com/aldrichcode45/peopleflow-vacantes/internal/features/documents/application"
)

// itemRow is one document with its current (highest) version, before the caller-dependent flags.
type itemRow struct {
	id string
	// participationID is nil for a vacancy document.
	participationID *string
	name            string
	createdAt       time.Time
	createdBy       documents.Person
	version         int
	versionCount    int
	contentType     string
	size            int64
	uploadedAt      time.Time
	uploadedBy      documents.Person
}

// newItem projects a row onto the contract's item. A stored content type outside the closed `format` enum is an error:
// the frontend rejects the whole list on an unknown value, so the read fails closed (500) instead.
func newItem(r itemRow, canManage bool) (documents.Item, error) {
	format, ok := documents.FormatFromContentType(r.contentType)
	if !ok {
		return documents.Item{}, fmt.Errorf("document %s: content type outside the format enum", r.id)
	}
	return documents.Item{
		ID:              r.id,
		ParticipationID: r.participationID, // null for the vacancy scope, always present on the wire
		Name:            r.name,
		Format:          format,
		ContentType:     r.contentType,
		Size:            r.size,
		Version:         r.version,
		VersionCount:    r.versionCount,
		CreatedAt:       documents.FormatTime(r.createdAt),
		CreatedBy:       r.createdBy,
		UpdatedAt:       documents.FormatTime(r.uploadedAt),
		UpdatedBy:       r.uploadedBy,
		AllowedActions:  documents.ItemActions(canManage, r.versionCount),
	}, nil
}

// linkRow is one link with its pinned source. Every source column is nil once the source document is deleted (D19).
type linkRow struct {
	id       string
	linkedAt time.Time
	linkedBy documents.Person

	sourceDocumentID      *string
	sourceProcessID       *string
	sourceParticipationID *string
	sourceName            *string
	pinnedVersion         *int32
	sourceContentType     *string
	size                  *int64
	uploadedAt            *time.Time
	uploadedBy            *documents.Person
	versionCount          *int32
	newestVersion         *int32
	sequence              *int32
	// readable: the caller may read the source's vacancy (D18).
	readable bool
}

// newLink projects a row onto the contract's link. removed (the source or the pinned version is gone) wins over
// inaccessible: a deleted source has nothing left to hide. An inaccessible link carries no source data at all.
func newLink(r linkRow, canManage bool) (documents.Link, error) {
	link := documents.Link{
		ID:       r.id,
		LinkedAt: documents.FormatTime(r.linkedAt),
		LinkedBy: r.linkedBy,
	}
	switch {
	case r.sourceDocumentID == nil || r.pinnedVersion == nil:
		link.State = documents.LinkRemoved
	case !r.readable:
		link.State = documents.LinkInaccessible
	default:
		link.State = documents.LinkAvailable
		source, err := newLinkSource(r)
		if err != nil {
			return documents.Link{}, err
		}
		link.Source = &source
	}
	link.AllowedActions = documents.LinkActions(canManage, link.State)
	return link, nil
}

func newLinkSource(r linkRow) (documents.LinkSource, error) {
	if r.sourceProcessID == nil || r.sourceName == nil || r.sourceContentType == nil || r.size == nil || r.uploadedAt == nil ||
		r.uploadedBy == nil || r.versionCount == nil || r.newestVersion == nil || r.sequence == nil {
		return documents.LinkSource{}, fmt.Errorf("link %s: incomplete source row", r.id)
	}
	format, ok := documents.FormatFromContentType(*r.sourceContentType)
	if !ok {
		return documents.LinkSource{}, fmt.Errorf("link %s: source content type outside the format enum", r.id)
	}
	return documents.LinkSource{
		DocumentID:      *r.sourceDocumentID,
		ProcessID:       *r.sourceProcessID,
		Sequence:        int(*r.sequence),
		ParticipationID: r.sourceParticipationID,
		Name:            *r.sourceName,
		Format:          format,
		Size:            *r.size,
		Version:         int(*r.pinnedVersion),
		VersionCount:    int(*r.versionCount),
		UploadedAt:      documents.FormatTime(*r.uploadedAt),
		UploadedBy:      *r.uploadedBy,
		HasNewerVersion: *r.newestVersion > *r.pinnedVersion,
	}, nil
}

// versionRow is one version of a document, as GET …/versions lists it.
type versionRow struct {
	version     int
	contentType string
	size        int64
	uploadedAt  time.Time
	uploadedBy  documents.Person
}

// newVersionItem projects a row onto the contract's version entry; current is the document's highest version number. A stored
// content type outside the closed `format` enum fails closed, like the list.
func newVersionItem(r versionRow, current int) (documents.VersionItem, error) {
	format, ok := documents.FormatFromContentType(r.contentType)
	if !ok {
		return documents.VersionItem{}, fmt.Errorf("document version %d: content type outside the format enum", r.version)
	}
	return documents.VersionItem{
		Version:     r.version,
		Format:      format,
		ContentType: r.contentType,
		Size:        r.size,
		UploadedAt:  documents.FormatTime(r.uploadedAt),
		UploadedBy:  r.uploadedBy,
		IsCurrent:   r.version == current,
	}, nil
}
