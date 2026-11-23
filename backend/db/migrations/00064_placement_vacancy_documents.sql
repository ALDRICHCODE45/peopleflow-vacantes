-- +goose Up
-- +goose StatementBegin
-- Placement and vacancy documents (docs/contracts/placement-vacancy-documents-v1.md «Data model»).
-- Additive only: three new tables, no change to an existing one.

-- One row per file document. participation_id IS NULL = vacancy document (job_drafts.id), else participation document.
-- Same company is enforced by the writer (the FK graph cannot express it), as for placement_credits.
CREATE TABLE placement_documents (
    id UUID PRIMARY KEY,
    company_id UUID NOT NULL REFERENCES companies (id),
    draft_id UUID NOT NULL REFERENCES job_drafts (id),
    participation_id UUID NULL REFERENCES process_participations (id),
    name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
    created_at TIMESTAMPTZ NOT NULL,
    created_by UUID NOT NULL REFERENCES users (id)
);
CREATE INDEX placement_documents_vacancy_idx ON placement_documents (draft_id, created_at, id)
    WHERE participation_id IS NULL;
CREATE INDEX placement_documents_participation_idx ON placement_documents (participation_id, created_at, id)
    WHERE participation_id IS NOT NULL;

-- Versions: current = highest version. storage_key is the adapter key (64 hex), never a path or a name.
CREATE TABLE placement_document_versions (
    id UUID PRIMARY KEY,
    document_id UUID NOT NULL REFERENCES placement_documents (id) ON DELETE CASCADE,
    version INTEGER NOT NULL CHECK (version BETWEEN 1 AND 25),
    storage_key TEXT NOT NULL UNIQUE CHECK (storage_key ~ '^[0-9a-f]{64}$'),
    content_type TEXT NOT NULL CHECK (content_type IN (
        'application/pdf',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'image/jpeg',
        'image/png'
    )),
    size BIGINT NOT NULL CHECK (size BETWEEN 1 AND 10485760),
    uploaded_at TIMESTAMPTZ NOT NULL,
    uploaded_by UUID NOT NULL REFERENCES users (id),
    UNIQUE (document_id, version)
);

-- A link from a replacement scope to a pinned source version. The source columns become NULL when the source is
-- deleted («removed»); there is deliberately no CHECK tying the two columns (the two SET NULL actions of one cascade
-- are separate row updates).
CREATE TABLE placement_document_links (
    id UUID PRIMARY KEY,
    company_id UUID NOT NULL REFERENCES companies (id),
    draft_id UUID NOT NULL REFERENCES job_drafts (id),
    participation_id UUID NULL REFERENCES process_participations (id),
    source_document_id UUID NULL REFERENCES placement_documents (id) ON DELETE SET NULL,
    source_version_id UUID NULL REFERENCES placement_document_versions (id) ON DELETE SET NULL,
    linked_at TIMESTAMPTZ NOT NULL,
    linked_by UUID NOT NULL REFERENCES users (id)
);
CREATE UNIQUE INDEX placement_document_links_vacancy_uq ON placement_document_links (draft_id, source_document_id)
    WHERE participation_id IS NULL AND source_document_id IS NOT NULL;
CREATE UNIQUE INDEX placement_document_links_participation_uq ON placement_document_links (participation_id, source_document_id)
    WHERE participation_id IS NOT NULL AND source_document_id IS NOT NULL;
CREATE INDEX placement_document_links_source_idx ON placement_document_links (source_document_id)
    WHERE source_document_id IS NOT NULL;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DO $$
BEGIN
    -- Lock out concurrent writers before checking for lossy rollback.
    LOCK TABLE placement_document_links, placement_document_versions, placement_documents IN ACCESS EXCLUSIVE MODE;
    IF EXISTS (SELECT 1 FROM placement_documents)
       OR EXISTS (SELECT 1 FROM placement_document_versions)
       OR EXISTS (SELECT 1 FROM placement_document_links) THEN
        RAISE EXCEPTION 'cannot remove placement documents: documents, versions or links exist';
    END IF;
END $$;
DROP TABLE placement_document_links;
DROP TABLE placement_document_versions;
DROP TABLE placement_documents;
-- +goose StatementEnd
