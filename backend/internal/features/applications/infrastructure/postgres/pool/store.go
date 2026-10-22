// Package pool implements the organization-wide candidate list in PostgreSQL.
package pool

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	app "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/application/pool"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/shared/languages"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Store struct {
	pool       *pgxpool.Pool
	stageNames app.StageNames
}

func NewStore(pool *pgxpool.Pool, stageNames app.StageNames) *Store { return &Store{pool, stageNames} }

var _ app.Reader = (*Store)(nil)

func (s *Store) Search(ctx context.Context, company uuid.UUID, q app.Query) (app.Page, error) {
	out := app.Page{Items: []app.Item{}}
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return out, err
	}
	defer tx.Rollback(ctx)
	if err := validateCatalogs(ctx, tx, company, q); err != nil {
		return out, err
	}
	args := []any{company}
	param := func(value any) string { args = append(args, value); return fmt.Sprintf("$%d", len(args)) }
	var filters strings.Builder
	if q.Q != "" {
		p := param(q.Q)
		filters.WriteString(" AND (strpos(lower(full_name)," + p + "::text)>0 OR strpos(lower(email)," + p + "::text)>0)")
	}
	if q.Origin != "" {
		filters.WriteString(" AND kind=" + param(q.Origin) + "::text")
	}
	if len(q.Vacancy) > 0 {
		filters.WriteString(" AND EXISTS(SELECT 1 FROM participations p WHERE p.kind=candidates.kind AND p.person_id=candidates.id AND p.process_id::text=ANY(" + param(q.Vacancy) + "::text[]))")
	}
	for _, dimension := range []struct {
		values     []string
		expression string
	}{
		{q.State, "profile#>>'{location,state}'"}, {q.Municipality, "profile#>>'{location,municipality}'"}, {q.Seniority, "profile->>'seniority'"},
	} {
		if len(dimension.values) > 0 {
			filters.WriteString(" AND COALESCE(" + dimension.expression + ",'none')=ANY(" + param(dimension.values) + "::text[])")
		}
	}
	if len(q.Years) > 0 {
		filters.WriteString(` AND (CASE WHEN profile->>'years_of_experience' IS NULL THEN 'none'
  WHEN (profile->>'years_of_experience')::numeric<1 THEN '0_1'
  WHEN (profile->>'years_of_experience')::numeric<3 THEN '1_3'
  WHEN (profile->>'years_of_experience')::numeric<5 THEN '3_5' ELSE '5_plus' END)=ANY(` + param(q.Years) + `::text[])`)
	}
	if len(q.Language) > 0 {
		codes := param(q.Language)
		filters.WriteString(" AND (('none'=ANY(" + codes + "::text[]) AND jsonb_array_length(profile->'languages')=0) OR EXISTS(SELECT 1 FROM jsonb_array_elements(profile->'languages') l WHERE l->>'code'=ANY(" + codes + "::text[])")
		if q.LanguageMinLevel != "" {
			levels := param(languages.LanguageLevels())
			min := param(q.LanguageMinLevel)
			filters.WriteString(" AND array_position(" + levels + "::text[],l->>'level')>=array_position(" + levels + "::text[]," + min + "::text)")
		}
		filters.WriteString("))")
	}
	if q.EducationLevel != "" {
		levels := param(languages.EducationLevels())
		min := param(q.EducationLevel)
		rank := "array_position(" + levels + "::text[]," + min + "::text)"
		filters.WriteString(" AND (array_position(" + levels + "::text[],profile#>>'{education,highest_completed}')>=" + rank)
		if q.EducationInProgress {
			filters.WriteString(" OR array_position(" + levels + "::text[],profile#>>'{education,in_progress}')>=" + rank)
		}
		filters.WriteString(")")
	}
	query := poolSQL + filters.String() + `), page AS (SELECT * FROM filtered WHERE true`
	if q.After != nil {
		at, kind, id := param(q.After.At), param(q.After.Kind), param(q.After.ID)
		query += ` AND (last_activity_at<` + at + `::timestamptz OR (last_activity_at=` + at + `::timestamptz AND (kind,id)>(` + kind + `::text,` + id + `::uuid)))`
	}
	query += ` ORDER BY last_activity_at DESC,kind,id LIMIT ` + param(q.Limit+1) + `)
 SELECT (SELECT count(*) FROM filtered),COALESCE((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.last_activity_at DESC,r.kind,r.id) FROM (` + projectionSQL + `) r),'[]'::jsonb)`
	var raw []byte
	if err := tx.QueryRow(ctx, query, args...).Scan(&out.Total, &raw); err != nil {
		return out, err
	}
	var rows []struct {
		app.Item
		StageConfiguration json.RawMessage `json:"stage_configuration"`
	}
	if err := json.Unmarshal(raw, &rows); err != nil {
		return out, err
	}
	for _, row := range rows {
		item := row.Item
		if loc := item.Profile.Location; loc != nil {
			if loc.Country.Name == "" || (loc.State != nil && loc.State.Name == "") || (loc.Municipality != nil && loc.Municipality.Name == "") {
				return out, errors.New("pool location catalog reference missing")
			}
		}
		item.LastActivityAt = item.LastActivityAt.UTC()
		if latest := item.LatestParticipation; latest != nil {
			names, err := s.stageNames(latest.Vacancy.ID, row.StageConfiguration)
			if err != nil {
				return out, err
			}
			name, ok := names[latest.Stage.ID]
			if !ok {
				return out, errors.New("pool stage reference missing")
			}
			latest.Stage.Name = name
			latest.AppliedAt = latest.AppliedAt.UTC()
		}
		out.Items = append(out.Items, item)
	}
	if err := tx.Commit(ctx); err != nil {
		return out, err
	}
	return out, nil
}

func validateCatalogs(ctx context.Context, tx pgx.Tx, company uuid.UUID, q app.Query) error {
	var state, municipality, vacancy bool
	err := tx.QueryRow(ctx, `SELECT
 NOT EXISTS(SELECT 1 FROM unnest($2::text[]) x WHERE x<>'none' AND NOT EXISTS(SELECT 1 FROM geo_states WHERE country_code='MX' AND code=x)),
 NOT EXISTS(SELECT 1 FROM unnest($3::text[]) x WHERE x<>'none' AND NOT EXISTS(SELECT 1 FROM geo_municipalities WHERE country_code='MX' AND code=x)),
 NOT EXISTS(SELECT 1 FROM unnest($4::text[]) x WHERE NOT EXISTS(SELECT 1 FROM job_drafts WHERE company_id=$1 AND id::text=x))`, company, q.State, q.Municipality, q.Vacancy).Scan(&state, &municipality, &vacancy)
	if err != nil {
		return err
	}
	fields := []app.Field{}
	if !municipality {
		fields = append(fields, app.Field{Field: "municipality", Code: "invalid"})
	}
	if !state {
		fields = append(fields, app.Field{Field: "state", Code: "invalid"})
	}
	if !vacancy {
		fields = append(fields, app.Field{Field: "vacancy", Code: "not_found"})
	}
	if len(fields) > 0 {
		return &app.InvalidFilter{Fields: fields}
	}
	return nil
}
