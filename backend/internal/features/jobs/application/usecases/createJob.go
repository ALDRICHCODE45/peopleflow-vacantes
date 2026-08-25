// Package usecases (jobs): the CreateJob orchestrator for POST /jobs.
//
// CreateJob implements the 8-step deterministic flow pinned by
// design §4.2 (D8):
//
//  1. trim + non-empty title/description       (ErrEmptyTitle / ErrEmptyDescription)
//  2. parse work_mode / employment_type /
//     seniority                                (VO sentinels)
//  3. salary_currency nil -> MXN; else parse   (D5)
//  4. salary_min <= salary_max when both       (ErrInvalidSalaryRange)
//  5. uuid.NewV7() for id                       (D4)
//  6. build repositories.CreateJobParams
//  7. repo.Create                              (propagate
//     ErrCompanyNotActive /
//     ErrCompanyGone /
//     ErrInvalidStatusTransition
//     untouched)
//  8. project toEditorView                     (reuses the
//     package-private helper
//     from updateJob.go -- D2
//     no parallel projection)
//
// Return contract:
//
//   - success                                  -> (view, nil)
//   - ErrEmptyTitle / ErrEmptyDescription / VO sentinel
//     -> (nil, err)
//   - ErrCompanyNotActive / ErrCompanyGone     -> (nil, err)        (HTTP 409)
//   - ErrInvalidStatusTransition               -> (nil, err)        (HTTP 400, defense-in-depth)
//   - any other error                          -> (nil, err)        (HTTP 500)
//
// There is no CAS and no status transition on create -- a new row is
// always born draft (status='draft' written explicitly in the SQL,
// design D1 / locked decision #1).
package usecases

import (
	"context"
	"strings"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/dtos"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/domain/entities"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/domain/repositories"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/domain/valueobjects"
	"github.com/google/uuid"
)

// CreateJob is the POST /jobs use case. The caller passes `companyID`
// from `security.CompanyContext` (the middleware injects it); the body
// NEVER carries company_id (the DTO has no company_id field -- spec
// scenario "company_id from body is ignored").
func (s *JobService) CreateJob(
	ctx context.Context,
	companyID uuid.UUID,
	in dtos.CreateJobDto,
) (*dtos.JobEditorViewDto, error) {
	// 1. Trim + non-empty title / description. The trim happens BEFORE
	// the empty check so whitespace-only strings collapse to "" and
	// surface as ErrEmptyTitle / ErrEmptyDescription. Mirrors PATCH's
	// non-empty-first ordering in EditJob.
	title := strings.TrimSpace(in.Title)
	if title == "" {
		return nil, entities.ErrEmptyTitle
	}
	description := strings.TrimSpace(in.Description)
	if description == "" {
		return nil, entities.ErrEmptyDescription
	}

	// 2. Parse the three required VOs. Failure surfaces the matching
	// sentinel (handler -> 400 with the field-naming message).
	wm, err := valueobjects.ParseWorkMode(in.WorkMode)
	if err != nil {
		return nil, err
	}
	et, err := valueobjects.ParseEmploymentType(in.EmploymentType)
	if err != nil {
		return nil, err
	}
	sn, err := valueobjects.ParseSeniority(in.Seniority)
	if err != nil {
		return nil, err
	}

	// 3. Parse optional salary_currency + default. nil -> MXN (D5).
	// The use case is the single resolver; the adapter never sees a
	// nil currency (it would never be able to write SQL NULL on a
	// NOT NULL column anyway).
	cur := valueobjects.MXN
	if in.SalaryCurrency != nil {
		parsed, err := valueobjects.ParseSalaryCurrency(*in.SalaryCurrency)
		if err != nil {
			return nil, err
		}
		cur = parsed
	}

	// 4. Salary range: only when BOTH fields are present and non-nil.
	// A lone salary_min (or salary_max) is permitted (transient state
	// mirrors the PATCH behavior exactly).
	if in.SalaryMin != nil && in.SalaryMax != nil && *in.SalaryMin > *in.SalaryMax {
		return nil, entities.ErrInvalidSalaryRange
	}

	// 5. Generate a UUID v7 (D4). Same call as entities.NewCompany.
	id, err := uuid.NewV7()
	if err != nil {
		return nil, err
	}

	// 6. Build the port-shaped params. Plain pointers for the
	// optional trio -- no Optional[T], no tri-state on create (D6).
	params := repositories.CreateJobParams{
		Title:          title,
		Description:    description,
		WorkMode:       wm,
		EmploymentType: et,
		Seniority:      sn,
		Location:       in.Location,
		SalaryMin:      in.SalaryMin,
		SalaryMax:      in.SalaryMax,
		SalaryCurrency: cur,
	}

	// 7. Call the repo. The adapter already maps pg errors to domain
	// sentinels; the use case propagates untouched so the handler's
	// classifyError is the single dispatcher.
	row, err := s.repo.Create(ctx, id, companyID, params)
	if err != nil {
		return nil, err
	}

	// 8. Project the JobForUpdate the adapter returned into the editor
	// view. Reuses the package-private toEditorView from updateJob.go
	// verbatim -- D2 forbids a parallel projection.
	return toEditorView(row), nil
}
