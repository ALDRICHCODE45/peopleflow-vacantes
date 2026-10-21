package board

import (
	"context"

	app "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/application/board"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

var _ app.DuplicateStore = (*Store)(nil)

// The identity set is company-scoped before contact comparison. Lateral reads
// include discarded/finished participations and source=manual organic reuse.
const duplicatesSQL = `WITH identities AS (
 SELECT 'manual'::text AS kind,c.id,c.full_name,c.email,c.phone
 FROM company_candidates c
 WHERE c.company_id=$1 AND (($3::text IS NOT NULL AND c.email_normalized=$3) OR ($4::text IS NOT NULL AND c.phone=$4))
 UNION ALL
 SELECT 'organic',u.id,u.full_name,u.email,cp.phone
 FROM users u LEFT JOIN candidate_profiles cp ON cp.user_id=u.id
 WHERE EXISTS (SELECT 1 FROM process_participations p JOIN vacancy_processes vp ON vp.id=p.process_id WHERE vp.company_id=$1 AND p.candidate_id=u.id)
 AND (($3::text IS NOT NULL AND lower(btrim(u.email))=$3) OR ($4::text IS NOT NULL AND cp.phone=$4))
)
SELECT i.kind,i.id,i.full_name,i.email,i.phone,last.process_id,last.title,last.created_at,
 EXISTS (SELECT 1 FROM process_participations p WHERE p.process_id=$2 AND
 ((i.kind='manual' AND p.company_candidate_id=i.id) OR (i.kind='organic' AND p.candidate_id=i.id)))
FROM identities i
LEFT JOIN LATERAL (
 SELECT p.process_id,COALESCE(v.title,'') AS title,p.created_at
 FROM process_participations p JOIN vacancy_processes vp ON vp.id=p.process_id LEFT JOIN vacancy_public_projections v ON v.id=vp.id
 WHERE vp.company_id=$1 AND ((i.kind='manual' AND p.company_candidate_id=i.id) OR (i.kind='organic' AND p.candidate_id=i.id))
 ORDER BY p.created_at DESC,p.id LIMIT 1
) last ON true
ORDER BY last.created_at DESC NULLS LAST,i.id`

func (s *Store) DuplicatesCheck(ctx context.Context, company, actor, id uuid.UUID, body []byte) (app.DuplicateMatches, error) {
	out := app.DuplicateMatches{Matches: []app.DuplicateMatch{}}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return out, err
	}
	defer tx.Rollback(ctx)
	// Same live company/member and owner-or-principal authorization as board.
	// Unlike a write, duplicate lookup also works before publication or after finish.
	if _, err = s.vacancy.Load(ctx, tx, company, actor, id); err != nil {
		return out, err
	}
	request, err := app.ParseDuplicateRequest(body)
	if err != nil {
		return out, err
	}
	if fields := request.Validate(); len(fields) > 0 {
		return out, &app.ManualValidationError{Fields: fields}
	}
	return readManualDuplicates(ctx, tx, company, id, request.Email, request.Phone)
}

func readManualDuplicates(ctx context.Context, tx pgx.Tx, company, id uuid.UUID, email, phone *string) (app.DuplicateMatches, error) {
	out := app.DuplicateMatches{Matches: []app.DuplicateMatch{}}
	rows, err := tx.Query(ctx, duplicatesSQL, company, id, email, phone)
	if err != nil {
		return out, err
	}
	defer rows.Close()
	for rows.Next() {
		var match app.DuplicateMatch
		var email, phone, title *string
		var vacancy *uuid.UUID
		if err = rows.Scan(&match.Kind, &match.ID, &match.FullName, &email, &phone, &vacancy, &title, &match.LastAddedAt, &match.InThisProcess); err != nil {
			return out, err
		}
		match.EmailMasked = app.MaskEmail(email)
		match.PhoneMasked = app.MaskPhone(phone)
		if vacancy != nil {
			match.LastVacancy = &app.DuplicateVacancy{ID: *vacancy, Title: *title}
		}
		if match.LastAddedAt != nil {
			at := match.LastAddedAt.UTC()
			match.LastAddedAt = &at
		}
		out.Matches = append(out.Matches, match)
	}
	return out, rows.Err()
}
