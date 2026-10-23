package pool

import (
	"context"
	"encoding/json"

	board "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/application/board"
	app "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/application/pool"
	"github.com/google/uuid"
)

// The requested identities are joined to the same company pool as the list,
// before reading contact. A correction alone never establishes membership.
// One statement snapshot covers membership, live contact and corrections.
func (s *Store) Contacts(ctx context.Context, company uuid.UUID, candidates []app.Identity) ([]app.ContactItem, error) {
	kinds := make([]string, len(candidates))
	ids := make([]uuid.UUID, len(candidates))
	for i, c := range candidates {
		kinds[i] = c.Kind
		ids[i] = c.ID
	}
	rows, err := s.pool.Query(ctx, `WITH requested AS (
 SELECT kind,id,ordinal FROM unnest($2::text[],$3::uuid[]) WITH ORDINALITY r(kind,id,ordinal)
 ), contacts AS (
 SELECT r.kind,r.id,r.ordinal,cc.email,cc.phone,'{}'::jsonb AS corrections
 FROM requested r JOIN company_candidates cc ON r.kind='manual' AND cc.id=r.id AND cc.company_id=$1
 UNION ALL
 SELECT r.kind,r.id,r.ordinal,u.email,NULLIF(btrim(cp.phone),''),COALESCE(o.corrections,'{}'::jsonb)
 FROM requested r JOIN users u ON r.kind='organic' AND u.id=r.id
 LEFT JOIN candidate_profiles cp ON cp.user_id=u.id
 LEFT JOIN company_candidate_corrections o ON o.company_id=$1 AND o.user_id=u.id
 WHERE EXISTS(SELECT 1 FROM process_participations p JOIN vacancy_processes vp ON vp.id=p.process_id
 WHERE vp.company_id=$1 AND p.company_candidate_id IS NULL AND p.candidate_id=u.id)
 ) SELECT kind,id,email,phone,corrections FROM contacts ORDER BY ordinal`, company, kinds, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []app.ContactItem{}
	for rows.Next() {
		var item app.ContactItem
		var contact board.Contact
		var raw []byte
		if err := rows.Scan(&item.Kind, &item.ID, &contact.Email, &contact.Phone, &raw); err != nil {
			return nil, err
		}
		var corrections map[string]json.RawMessage
		if err := json.Unmarshal(raw, &corrections); err != nil {
			return nil, err
		}
		effective, err := app.CorrectedContact(contact, corrections)
		if err != nil {
			return nil, err
		}
		item.Email, item.Phone = effective.Email, effective.Phone
		out = append(out, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return out, nil
}
