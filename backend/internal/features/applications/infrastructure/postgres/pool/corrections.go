package pool

import (
	"context"
	"encoding/json"
	"errors"
	"sort"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/db"
	board "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/application/board"
	app "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/application/pool"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

var _ app.OrganicEditor = (*Store)(nil)

// Organic rows are lazily created only after membership is checked. The unique
// company/user key also serializes concurrent FIRST edits (no correction yet).
// Lock and compare under READ COMMITTED, just like manual edits.
func (s *Store) EditOrganic(ctx context.Context, company, actor, id uuid.UUID, etag string, body []byte) (app.Detail, error) {
	var out app.Detail
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return out, err
	}
	defer tx.Rollback(ctx)
	var visible bool
	if err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM process_participations p JOIN vacancy_processes vp ON vp.id=p.process_id WHERE vp.company_id=$1 AND p.company_candidate_id IS NULL AND p.candidate_id=$2)`, company, id).Scan(&visible); err != nil {
		return out, err
	}
	if !visible {
		return out, board.ErrNotFound
	}
	if _, err = tx.Exec(ctx, `INSERT INTO company_candidate_corrections(company_id,user_id) VALUES($1,$2) ON CONFLICT(company_id,user_id) DO NOTHING`, company, id); err != nil {
		return out, err
	}
	var version int64
	var raw []byte
	if err = tx.QueryRow(ctx, `SELECT version,corrections FROM company_candidate_corrections WHERE company_id=$1 AND user_id=$2 FOR UPDATE`, company, id).Scan(&version, &raw); err != nil {
		return out, err
	}
	if etag != app.OrganicETag(company, id, version) {
		return out, app.ErrPreconditionFailed
	}
	set, reset, err := board.ParseOrganicEdit(body)
	if err != nil {
		return out, err
	}
	corrections := map[string]json.RawMessage{}
	if err = json.Unmarshal(raw, &corrections); err != nil {
		return out, err
	}
	// Read originals and the current response under the correction lock. No
	// candidate-owned row is locked or written by this operation.
	out, err = s.detail(ctx, tx, company, "organic", id)
	if err != nil {
		return out, err
	}
	next, changes, err := app.PrepareOrganicEdit(ctx, editGeoLookup{db.New(tx)}, app.OrganicValues(out.Original), corrections, set, reset)
	if err != nil {
		return out, err
	}
	if len(changes) == 0 {
		return out, tx.Commit(ctx)
	}
	raw, err = json.Marshal(next)
	if err != nil {
		return out, err
	}
	if _, err = tx.Exec(ctx, `UPDATE company_candidate_corrections SET corrections=$3::jsonb,version=version+1,updated_at=clock_timestamp(),updated_by=$4 WHERE company_id=$1 AND user_id=$2`, company, id, raw, actor); err != nil {
		return out, err
	}
	if err = recordEdit(ctx, tx, company, actor, id, "organic", changes); err != nil {
		return out, err
	}
	out, err = s.detail(ctx, tx, company, "organic", id)
	if err != nil {
		return out, err
	}
	return out, tx.Commit(ctx)
}

// The existing pool SQL hydrates original and effective profiles with the same
// catalogs. Do not derive originals from the effective item or the live profile.
func organicDetail(ctx context.Context, tx pgx.Tx, company, id uuid.UUID, out *app.Detail) error {
	query := poolSQL + ` AND kind='organic' AND id=$2), page AS (
 SELECT kind,id,original_full_name AS full_name,NULL::text AS professional_title,NULL::text AS current_company,NULL::text AS postal_code,original_profile AS profile,last_activity_at,total,active,process_id,stage_id,discarded_at,applied_at FROM filtered
 ) SELECT to_jsonb(r) FROM (` + projectionSQL + `) r`
	var raw []byte
	if err := tx.QueryRow(ctx, query, company, id).Scan(&raw); err != nil {
		return err
	}
	var original app.Item
	if err := json.Unmarshal(raw, &original); err != nil {
		return err
	}
	// Copy the pointed-to values: corrections below unmarshal into out.Contact,
	// and sharing its pointers would rewrite the original contact too.
	out.Original = &app.Original{FullName: original.FullName, Profile: original.Profile, Contact: out.Contact}
	out.Original.Contact.Email = cloneString(out.Contact.Email)
	out.Original.Contact.Phone = cloneString(out.Contact.Phone)
	var version int64
	var updatedID *uuid.UUID
	var name *string
	err := tx.QueryRow(ctx, `SELECT COALESCE(o.version,1),o.updated_at,o.updated_by,u.full_name,COALESCE(o.corrections,'{}'::jsonb) FROM (SELECT true) seed LEFT JOIN company_candidate_corrections o ON o.company_id=$1 AND o.user_id=$2 LEFT JOIN users u ON u.id=o.updated_by AND u.deleted_at IS NULL`, company, id).Scan(&version, &out.UpdatedAt, &updatedID, &name, &raw)
	if err != nil {
		return err
	}
	out.ETag = app.OrganicETag(company, id, version)
	if updatedID != nil {
		out.UpdatedBy = &app.Creator{ID: *updatedID, Name: name}
	}
	var corrections map[string]json.RawMessage
	if err = json.Unmarshal(raw, &corrections); err != nil {
		return err
	}
	for key := range corrections {
		out.CorrectedFields = append(out.CorrectedFields, key)
	}
	sort.Strings(out.CorrectedFields)
	out.Contact, err = app.CorrectedContact(out.Original.Contact, corrections)
	if err != nil {
		return err
	}
	for _, field := range []struct {
		key    string
		target any
	}{
		{"education", &out.Education}, {"linkedin_url", &out.LinkedInURL}, {"portfolio_url", &out.PortfolioURL},
	} {
		if value, present := corrections[field.key]; present {
			if err = json.Unmarshal(value, field.target); err != nil {
				return err
			}
		}
	}
	return nil
}

// Shared co-write boundary: private values go only to history. Shared audit
// metadata is strictly field names, including for organic resets.
func recordEdit(ctx context.Context, tx pgx.Tx, company, actor, id uuid.UUID, kind string, changes []app.Change) error {
	if len(changes) == 0 {
		return errors.New("empty candidate edit")
	}
	history, err := json.Marshal(changes)
	if err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `INSERT INTO company_candidate_history(id,company_id,candidate_kind,candidate_id,actor_id,changes) VALUES($1,$2,$3,$4,$5,$6::jsonb)`, uuid.New(), company, kind, id, actor, history); err != nil {
		return err
	}
	names := make([]string, 0, len(changes))
	for _, c := range changes {
		names = append(names, c.Field)
	}
	metadata, err := json.Marshal(map[string]any{"fields": names})
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `INSERT INTO audit_events(id,actor_id,actor_type,event_type,entity_type,entity_id,metadata) VALUES($1,$2,'user','CompanyCandidateEdited','company_candidate',$3,$4::jsonb)`, uuid.New(), actor, id, metadata)
	return err
}

func cloneString(value *string) *string {
	if value == nil {
		return nil
	}
	copied := *value
	return &copied
}
