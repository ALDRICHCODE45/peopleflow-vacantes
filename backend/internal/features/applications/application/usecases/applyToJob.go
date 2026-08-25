package usecases

import (
	"context"
	"strings"
	"unicode/utf8"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/application/dtos"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/domain/entities"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/domain/repositories"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/domain/valueobjects"
	"github.com/google/uuid"
)

// sentinelCoverLetterEmpty / sentinelCoverLetterTooLong / sentinelJobNotApplicable /
// sentinelAlreadyApplied / sentinelStatusRequired / sentinelApplicationNotFound /
// sentinelInvalidStatusTransition / sentinelInvalidSource are package-local
// aliases for the entity / valueobject sentinels used by the use-case tests.
// Defining them here (in the production file rather than the _test.go
// file) keeps the test file's import graph minimal — the test files
// reference these names without importing entities/valueobjects directly.
var (
	sentinelCoverLetterEmpty        = entities.ErrCoverLetterEmpty
	sentinelCoverLetterTooLong      = entities.ErrCoverLetterTooLong
	sentinelJobNotApplicable        = entities.ErrJobNotApplicable
	sentinelAlreadyApplied          = entities.ErrAlreadyApplied
	sentinelStatusRequired          = entities.ErrStatusRequired
	sentinelApplicationNotFound     = entities.ErrApplicationNotFound
	sentinelInvalidStatusTransition = valueobjects.ErrInvalidStatusTransition
	sentinelInvalidSource           = valueobjects.ErrInvalidSource
)

// applyJobDtoType mirrors dtos.ApplyRequestDto by structural alias so the
// test file can construct request DTOs without importing dtos directly
// (the test file is in the same package and the import would be a cycle).
type applyJobDtoType = dtos.ApplyRequestDto

// transitionRequestDto mirrors dtos.TransitionRequestDto by structural
// alias — same rationale as applyJobDtoType.
type transitionRequestDto = dtos.TransitionRequestDto

// transitionRequestDtoFromStatus is a tiny helper for the test files: a
// `transitionRequestDto("in_review")` call would not type-check (the
// alias is a struct type, not a constructor), so this helper takes the
// status string and produces the DTO value the use case expects.
func transitionRequestDtoFromStatus(status string) dtos.TransitionRequestDto {
	return dtos.TransitionRequestDto{Status: status}
}

// entities_ErrApplicationNotFound is a thin wrapper exported for the
// test file (lives in production code so the test file does not need to
// import the entities package directly).
func entities_ErrApplicationNotFound() error { return entities.ErrApplicationNotFound }

// entities_ErrStatusRequired is the matching wrapper for the
// ErrStatusRequired sentinel — used by the transition tests' missing-status
// case.
func entities_ErrStatusRequired() error { return entities.ErrStatusRequired }

// valueobjects_ErrInvalidStatusTransition mirrors the valueobjects
// package sentinel for test access.
func valueobjects_ErrInvalidStatusTransition() error { return valueobjects.ErrInvalidStatusTransition }

// ApplyJob is the candidate-facing write path: resolve cognitoSub → users.id,
// validate the optional cover_letter + source, then hand a CreateParams
// (with a fresh UUID v7) to the repository. The repository's atomic SQL
// gate enforces the eligibility predicate (published + deleted_at IS NULL
// + active company).
//
// Validation order (design D8):
//  1. Resolve identity → ErrUnknownSubject (401) on miss.
//  2. Normalize cover_letter: trim; empty-after-trim → ErrCoverLetterEmpty;
//     > 2000 runes (utf8.RuneCountInString) → ErrCoverLetterTooLong.
//     nil cover_letter is allowed and stored as SQL NULL.
//  3. Parse source: nil is allowed (stored as SQL NULL); unknown →
//     ErrInvalidSource.
//  4. Create with a fresh UUID v7 — the row is born with the DB's
//     DEFAULT 'submitted' status (CreateApplication SQL never inserts
//     status; design D1).
//
// Repo-side sentinels (ErrJobNotApplicable, ErrAlreadyApplied,
// ErrInvalidApplicationReference, ErrInvalidStatusTransition) pass
// through untouched so the HTTP classifier maps them to 404 / 409 / 400.
func (s *ApplicationService) ApplyJob(
	ctx context.Context,
	cognitoSub string,
	jobID uuid.UUID,
	in dtos.ApplyRequestDto,
) (*entities.Application, error) {
	candidateID, err := s.resolveUserID(ctx, cognitoSub)
	if err != nil {
		return nil, err
	}

	cover, err := normalizeCoverLetter(in.CoverLetter)
	if err != nil {
		return nil, err
	}

	source, err := normalizeSource(in.Source)
	if err != nil {
		return nil, err
	}

	id, err := uuid.NewV7()
	if err != nil {
		return nil, err
	}

	return s.repo.Create(ctx, repositories.CreateParams{
		ID:          id,
		JobID:       jobID,
		CandidateID: candidateID,
		Source:      source,
		CoverLetter: cover,
	})
}

// normalizeCoverLetter trims the input cover_letter and applies the
// 2000-rune length bound. The bound is a rune count (the spec uses
// "characters"), so utf8.RuneCountInString is the right tool — len()
// would measure bytes and undercount multi-byte glyphs.
//
//   - nil           → nil, nil (absent on the wire; SQL NULL).
//   - empty after trim → nil, ErrCoverLetterEmpty.
//   - > 2000 runes  → nil, ErrCoverLetterTooLong.
//   - 1..2000 runes → &trimmed, nil (stored trimmed).
func normalizeCoverLetter(in *string) (*string, error) {
	if in == nil {
		return nil, nil
	}
	trimmed := strings.TrimSpace(*in)
	if trimmed == "" {
		return nil, entities.ErrCoverLetterEmpty
	}
	if utf8.RuneCountInString(trimmed) > 2000 {
		return nil, entities.ErrCoverLetterTooLong
	}
	out := trimmed
	return &out, nil
}

// normalizeSource parses an optional source pointer through the VO codec.
// nil is allowed (stored as SQL NULL); an unknown value (e.g. "newspaper")
// surfaces as ErrInvalidSource (400 on the wire).
func normalizeSource(in *string) (*valueobjects.ApplicationSource, error) {
	if in == nil {
		return nil, nil
	}
	src, err := valueobjects.ParseApplicationSource(*in)
	if err != nil {
		return nil, err
	}
	return &src, nil
}
