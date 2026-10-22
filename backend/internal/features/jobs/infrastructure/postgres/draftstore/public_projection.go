package draftstore

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/db"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/publication"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/publicjobs"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// Called while holding the shared draft write lock. For config replacements,
// the candidate config is already visible inside this transaction; rejection
// rolls it back before any audit or commit. No other connection sees it.
func (s *Store) guardPublishedWrite(ctx context.Context, tx pgx.Tx, record draftRecord) error {
	at, err := readPublishedAt(ctx, tx, record.id)
	if err != nil || at == nil {
		return err
	}
	missing, _, err := publicationRequirements(ctx, tx, record, s.clock())
	if err != nil {
		return err
	}
	missing = publication.PublishedWriteMissing(missing)
	if len(missing) > 0 {
		return &publication.Incomplete{Missing: missing}
	}
	return nil
}

func (s *Store) guardPublishedConfiguration(ctx context.Context, tx pgx.Tx, companyID, id uuid.UUID) error {
	record, _, err := readDraft(ctx, tx, companyID, id, false)
	if err != nil {
		return err
	}
	return s.guardPublishedWrite(ctx, tx, record)
}

func refreshPublicProjection(ctx context.Context, tx pgx.Tx, record draftRecord) error {
	at, err := readPublishedAt(ctx, tx, record.id)
	if err != nil || at == nil {
		return err
	}
	return writePublicProjection(ctx, tx, record, *at)
}

func writePublicProjection(ctx context.Context, tx pgx.Tx, record draftRecord, at time.Time) error {
	p, err := publicjobs.BuildProjection(record.fields)
	if err != nil {
		return err
	}
	profile, err := json.Marshal(p.RequirementsProfile)
	if err != nil {
		return fmt.Errorf("encode public requirements profile: %w", err)
	}
	benefits, err := json.Marshal(p.Benefits)
	if err != nil {
		return fmt.Errorf("encode public benefits: %w", err)
	}
	var compensation []byte
	if p.Compensation != nil {
		compensation, err = json.Marshal(p.Compensation)
		if err != nil {
			return fmt.Errorf("encode public compensation: %w", err)
		}
	}
	text := func(p *string) pgtype.Text {
		if p == nil {
			return pgtype.Text{}
		}
		return pgtype.Text{String: *p, Valid: true}
	}
	optional := func(value string) pgtype.Text { return pgtype.Text{String: value, Valid: value != ""} }
	var country, state, municipality, postal, scope string
	var countries []string
	if p.Location != nil {
		country, state, municipality, postal = p.Location.Country, p.Location.State, p.Location.Municipality, p.Location.PostalCode
	}
	if p.RemoteScope != nil {
		scope, countries = p.RemoteScope.Kind, p.RemoteScope.Countries
	}
	err = db.New(tx).UpsertVacancyPublicProjection(ctx, db.UpsertVacancyPublicProjectionParams{
		ID: record.id, CompanyID: record.companyID, Title: p.Title, Description: p.Description, DescriptionPlain: p.DescriptionPlain,
		CountryCode: optional(country), StateCode: optional(state), MunicipalityCode: optional(municipality), PostalCode: optional(postal), RemoteScopeKind: optional(scope), RemoteCountries: countries,
		WorkMode: *p.WorkMode, WorkSchedule: *p.WorkSchedule, ContractType: *p.ContractType, ProfessionalArea: *p.ProfessionalArea,
		Seniority: text(p.Seniority), RequiredRequirements: text(p.Requirements.Required), PreferredRequirements: text(p.Requirements.Preferred),
		Skills: p.Skills, ScreeningQuestions: int32(p.ScreeningQuestions), RequirementsProfile: profile,
		Benefits: benefits, Compensation: compensation, PublishedAt: pgtype.Timestamptz{Time: at, Valid: true}, SourceDraftVersion: record.version,
	})
	if err != nil {
		return fmt.Errorf("write public projection: %w", err)
	}
	return nil
}
