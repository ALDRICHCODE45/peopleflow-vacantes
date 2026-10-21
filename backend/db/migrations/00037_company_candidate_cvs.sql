-- +goose Up
-- +goose StatementBegin
-- Same private adapter keys and Inspect size/content types as candidate CVs.
-- Owned by the company: a manual intake that reuses an organic account stores
-- its CV here with a null company_candidate_id, never in the candidate's library.
CREATE TABLE company_candidate_cvs (
    id UUID PRIMARY KEY,
    company_id UUID NOT NULL REFERENCES companies(id),
    company_candidate_id UUID REFERENCES company_candidates(id),
    storage_key TEXT NOT NULL UNIQUE CHECK (storage_key ~ '^[0-9a-f]{64}$'),
    size BIGINT NOT NULL CHECK (size BETWEEN 1 AND 5242880),
    content_type TEXT NOT NULL CHECK (content_type IN ('application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document')),
    file_name TEXT NOT NULL,
    uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (id, company_candidate_id)
);
CREATE INDEX company_candidate_cvs_company_idx ON company_candidate_cvs (company_id);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
LOCK TABLE company_candidate_cvs IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM company_candidate_cvs) THEN
  RAISE EXCEPTION 'manual CV data exists; rollback requires an explicit retention decision';
 END IF;
END $$;
DROP TABLE company_candidate_cvs;
-- +goose StatementEnd
