package board

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/db"
	app "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/application/board"
	geo "github.com/aldrichcode45/peopleflow-vacantes/internal/features/geo/domain"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

func manualIdentity(ctx context.Context, tx pgx.Tx, company, process uuid.UUID, r app.ValidatedManualRequest) (uuid.UUID, []byte, error) {
	if r.Existing == nil {
		matches, err := readManualDuplicates(ctx, tx, company, process, r.Candidate.EmailNormalized, r.Candidate.Phone)
		if err != nil {
			return uuid.Nil, nil, err
		}
		if len(matches.Matches) > 0 && !r.ConfirmedDistinct {
			return uuid.Nil, nil, &app.PossibleDuplicates{Matches: matches.Matches}
		}
		c := r.Candidate
		profile, err := json.Marshal(map[string]any{"location": map[string]any{"country": c.Residence.Country, "state": manualNullable(c.Residence.State), "municipality": manualNullable(c.Residence.Municipality)}, "skills": c.Skills, "years_of_experience": c.ExperienceYears, "education_level": c.EducationLevel})
		return uuid.New(), profile, err
	}
	identity := r.Existing.ID
	var profile []byte
	var err error
	if r.Existing.Kind == "manual" {
		err = tx.QueryRow(ctx, `SELECT jsonb_build_object('location',jsonb_build_object('country',country_code,'state',state_code,'municipality',municipality_code),'skills',skills,'years_of_experience',experience_years,'education_level',education_level) FROM company_candidates WHERE company_id=$1 AND id=$2 FOR SHARE`, company, identity).Scan(&profile)
	} else {
		err = tx.QueryRow(ctx, `SELECT jsonb_build_object('location',CASE WHEN cp.country_code IS NULL THEN NULL ELSE jsonb_build_object('country',cp.country_code,'state',cp.state_code,'municipality',cp.municipality_code) END,'skills',COALESCE(cp.skills,'{}'::text[]),'years_of_experience',trunc(cp.years_of_experience)::integer,'education_level',(SELECT level FROM candidate_educations e WHERE e.user_id=cp.user_id AND e.status='completed' AND e.level IN ('high_school','bachelor','master','phd') ORDER BY CASE e.level WHEN 'phd' THEN 4 WHEN 'master' THEN 3 WHEN 'bachelor' THEN 2 ELSE 1 END DESC,e.position,e.id LIMIT 1)) FROM users u LEFT JOIN candidate_profiles cp ON cp.user_id=u.id WHERE u.id=$2 AND EXISTS(SELECT 1 FROM process_participations p JOIN vacancy_processes vp ON vp.id=p.process_id WHERE vp.company_id=$1 AND p.candidate_id=u.id) FOR SHARE OF u`, company, identity).Scan(&profile)
	}
	if errors.Is(err, pgx.ErrNoRows) {
		return uuid.Nil, nil, &app.ManualValidationError{Fields: []app.ManualFieldError{{Field: "existing", Code: "invalid"}}}
	}
	if err != nil {
		return uuid.Nil, nil, err
	}
	var pid uuid.UUID
	err = tx.QueryRow(ctx, `SELECT id FROM process_participations WHERE process_id=$1 AND (($2='manual' AND company_candidate_id=$3) OR ($2='organic' AND candidate_id=$3))`, process, r.Existing.Kind, identity).Scan(&pid)
	if err == nil {
		return uuid.Nil, nil, &app.CandidateAlreadyInProcess{ParticipationID: pid}
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return uuid.Nil, nil, err
	}
	return identity, profile, nil
}

func manualNullable(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}
func insertManualCandidate(ctx context.Context, tx pgx.Tx, company, actor, id uuid.UUID, c *app.ManualCandidate) error {
	_, err := tx.Exec(ctx, `INSERT INTO company_candidates(id,company_id,full_name,email,email_normalized,phone,education_level,country_code,state_code,municipality_code,postal_code,professional_title,current_company,field_of_study,experience_years,summary,skills,linkedin_url,portfolio_url,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`, id, company, c.FullName, c.Email, c.EmailNormalized, c.Phone, c.EducationLevel, c.Residence.Country, manualNullable(c.Residence.State), manualNullable(c.Residence.Municipality), manualNullable(c.Residence.PostalCode), c.ProfessionalTitle, c.CurrentCompany, c.FieldOfStudy, c.ExperienceYears, c.Summary, c.Skills, c.LinkedInURL, c.PortfolioURL, actor)
	if err != nil {
		return err
	}
	for _, l := range c.Languages {
		if _, err = tx.Exec(ctx, `INSERT INTO company_candidate_languages(company_candidate_id,language,level) VALUES($1,$2,$3)`, id, l.Language, l.Level); err != nil {
			return err
		}
	}
	return nil
}

// A transaction-bound catalog lookup keeps validation on the intake connection.
// It adapts generated queries, not another feature's infrastructure package.
type manualGeoLookup struct{ q *db.Queries }

func (g manualGeoLookup) CountryExists(ctx context.Context, country string) (bool, error) {
	return g.q.GeoCountryExists(ctx, country)
}
func (g manualGeoLookup) StateExists(ctx context.Context, country, state string) (bool, error) {
	return g.q.GeoStateExists(ctx, db.GeoStateExistsParams{CountryCode: country, Code: state})
}
func (g manualGeoLookup) MunicipalityState(ctx context.Context, country, municipality string) (string, error) {
	s, err := g.q.GeoMunicipalityState(ctx, db.GeoMunicipalityStateParams{CountryCode: country, Code: municipality})
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	return s, err
}
func (g manualGeoLookup) PostalMatches(ctx context.Context, country, postal string) ([]geo.PostalMatch, error) {
	rows, err := g.q.GeoPostalMatches(ctx, db.GeoPostalMatchesParams{CountryCode: country, PostalCode: postal})
	out := make([]geo.PostalMatch, 0, len(rows))
	for _, r := range rows {
		out = append(out, geo.PostalMatch{State: geo.Item{Code: r.StateCode, Name: r.StateName}, Municipality: geo.Item{Code: r.MunicipalityCode, Name: r.MunicipalityName}})
	}
	return out, err
}
