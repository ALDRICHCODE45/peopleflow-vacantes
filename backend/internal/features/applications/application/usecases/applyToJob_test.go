package usecases

import (
	"context"
	"errors"
	"reflect"
	"testing"

	applicationsvalueobjects "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/domain/valueobjects"
	auditentities "github.com/aldrichcode45/peopleflow-vacantes/internal/features/audit_events/domain/entities"
	identityentities "github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/entities"
	"github.com/google/uuid"
)

// makeJobID returns a stable UUID for tests so the captured-call assertions
// are deterministic.
func makeJobID() uuid.UUID {
	return uuid.MustParse("018e0000-0000-7000-8000-000000000111")
}

// makeCandidateID returns a stable UUID for tests.
func makeCandidateID() uuid.UUID {
	return uuid.MustParse("018e0000-0000-7000-8000-000000000222")
}

// makeUserStub configures stubUserRepo to resolve cognitoSub → candidateID.
func makeUserStub(t *testing.T, repo *stubUserRepo, cognitoSub string, candidateID uuid.UUID) {
	t.Helper()
	repo.getByCognitoSubUser = &identityentities.User{ID: candidateID}
	repo.getByCognitoSubErr = nil
	repo.lastSub = "" // reset
	if repo.getByCognitoSubUser.ID != candidateID {
		t.Fatalf("test setup: candidateID mismatch")
	}
}

// --- TestApplyJob_Success -----------------------------------------------

// TestApplyJob_Success proves the happy path: resolve sub → candidateID,
// parse source, call repo.Create with v7 id, return
// the application (with status='submitted').
func TestApplyJob_Success(t *testing.T) {
	repo := &stubApplicationRepo{}
	userRepo := &stubUserRepo{}
	candidateID := makeCandidateID()
	makeUserStub(t, userRepo, "sub-1", candidateID)

	jobID := makeJobID()
	source := "linkedin"
	svc := NewApplicationService(repo, userRepo)

	got, err := svc.ApplyJob(context.Background(), "sub-1", jobID, applyJobDto(&source))
	if err != nil {
		t.Fatalf("ApplyJob: unexpected err %v", err)
	}
	if got == nil {
		t.Fatal("ApplyJob: want non-nil application")
	}
	if got.Status != applicationsvalueobjects.Submitted {
		t.Errorf("ApplyJob: want status=submitted, got %v", got.Status)
	}
	if repo.createCalls != 1 {
		t.Errorf("Create calls: want 1, got %d", repo.createCalls)
	}
	if repo.lastCreate == nil {
		t.Fatal("lastCreate: want non-nil")
	}
	if repo.lastCreate.JobID != jobID {
		t.Errorf("CreateParams.JobID: want %v, got %v", jobID, repo.lastCreate.JobID)
	}
	if repo.lastCreate.CandidateID != candidateID {
		t.Errorf("CreateParams.CandidateID: want %v (resolved from sub), got %v", candidateID, repo.lastCreate.CandidateID)
	}
	if repo.lastCreate.Source == nil || *repo.lastCreate.Source != applicationsvalueobjects.LinkedIn {
		t.Errorf("CreateParams.Source: want linkedin, got %v", repo.lastCreate.Source)
	}
	// UUID v7 — version nibble = 7.
	if got.ID.Version() != 7 {
		t.Errorf("Application.ID: want UUID v7, got version %d", got.ID.Version())
	}
}

// --- TestApplyJob_PassesSubmittedEvent -------------------------------------

// TestApplyJob_PassesSubmittedEvent pins D7's event-intent flow: ApplyJob
// builds the ApplicationSubmitted event and hands it to repo.Create. The stub
// captures lastCreateEvent, proving the use case (not the adapter) owns the
// actor + metadata resolution: ActorType=user, ActorID=candidateID (the
// resolved users.id), EventType=ApplicationSubmitted, EntityType=application,
// EntityID=appID (the created row id), and the PII-free {job_id, source}
// metadata when a source is present.
func TestApplyJob_PassesSubmittedEvent(t *testing.T) {
	repo := &stubApplicationRepo{}
	userRepo := &stubUserRepo{}
	candidateID := makeCandidateID()
	makeUserStub(t, userRepo, "sub-1", candidateID)

	jobID := makeJobID()
	source := "linkedin"
	svc := NewApplicationService(repo, userRepo)

	got, err := svc.ApplyJob(context.Background(), "sub-1", jobID, applyJobDto(&source))
	if err != nil {
		t.Fatalf("ApplyJob: unexpected err %v", err)
	}
	if got == nil {
		t.Fatal("ApplyJob: want non-nil application")
	}
	if repo.createCalls != 1 {
		t.Fatalf("Create calls: want 1, got %d", repo.createCalls)
	}
	if repo.lastCreateEvent == nil {
		t.Fatal("lastCreateEvent: want non-nil (the use case must pass an event)")
	}
	e := repo.lastCreateEvent
	if e.ActorType != auditentities.ActorTypeUser {
		t.Errorf("ActorType: want %q, got %q", auditentities.ActorTypeUser, e.ActorType)
	}
	if e.ActorID == nil || *e.ActorID != candidateID {
		t.Errorf("ActorID: want %v (resolved candidate users.id), got %v", candidateID, e.ActorID)
	}
	if e.EventType != auditentities.EventApplicationSubmitted {
		t.Errorf("EventType: want %q, got %q", auditentities.EventApplicationSubmitted, e.EventType)
	}
	if e.EntityType != auditentities.EntityApplication {
		t.Errorf("EntityType: want %q, got %q", auditentities.EntityApplication, e.EntityType)
	}
	if repo.lastCreate == nil {
		t.Fatal("lastCreate: want non-nil")
	}
	if e.EntityID != repo.lastCreate.ID {
		t.Errorf("EntityID: want %v (the created app id), got %v", repo.lastCreate.ID, e.EntityID)
	}
	wantMeta := map[string]string{"job_id": jobID.String(), "source": "linkedin"}
	if !reflect.DeepEqual(e.Metadata, wantMeta) {
		t.Errorf("Metadata: want %v, got %v", wantMeta, e.Metadata)
	}
}

// --- TestApplyJob_UnknownSubReturnsUnknownSubject -------------------------

// TestApplyJob_UnknownSubReturnsUnknownSubject pins the IDOR-resistant
// boundary: identity ErrUserNotFound → ErrUnknownSubject; Create MUST NOT
// be called.
func TestApplyJob_UnknownSubReturnsUnknownSubject(t *testing.T) {
	repo := &stubApplicationRepo{}
	userRepo := &stubUserRepo{getByCognitoSubErr: identityentities.ErrUserNotFound}

	svc := NewApplicationService(repo, userRepo)
	got, err := svc.ApplyJob(context.Background(), "sub-unknown", makeJobID(), applyJobDto(nil))
	if !errors.Is(err, ErrUnknownSubject) {
		t.Errorf("want ErrUnknownSubject, got %v", err)
	}
	if got != nil {
		t.Errorf("want nil application, got %v", got)
	}
	if repo.createCalls != 0 {
		t.Errorf("Create MUST NOT be called on unknown sub; got %d calls", repo.createCalls)
	}
}

// --- TestApplyJob_UnknownSource -----------------------------------------

// TestApplyJob_UnknownSource: out-of-vocabulary source → ErrInvalidSource.
func TestApplyJob_UnknownSource(t *testing.T) {
	repo := &stubApplicationRepo{}
	userRepo := &stubUserRepo{}
	makeUserStub(t, userRepo, "sub-1", makeCandidateID())
	svc := NewApplicationService(repo, userRepo)

	source := "newspaper"
	got, err := svc.ApplyJob(context.Background(), "sub-1", makeJobID(), applyJobDto(&source))
	if !errors.Is(err, valueobjects_ErrInvalidSource()) {
		t.Errorf("want ErrInvalidSource, got %v", err)
	}
	if got != nil {
		t.Errorf("want nil application, got %v", got)
	}
	if repo.createCalls != 0 {
		t.Errorf("Create MUST NOT be called on unknown source; got %d calls", repo.createCalls)
	}
}

// --- TestApplyJob_CreateErrorsPropagate ----------------------------------

// TestApplyJob_CreateErrorsPropagate: repo-side sentinels pass through untouched.
func TestApplyJob_CreateErrorsPropagate(t *testing.T) {
	cases := []struct {
		name string
		err  error
	}{
		{"ErrJobNotApplicable propagates", entities_ErrJobNotApplicable()},
		{"ErrAlreadyApplied propagates", entities_ErrAlreadyApplied()},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			repo := &stubApplicationRepo{createErr: c.err}
			userRepo := &stubUserRepo{}
			makeUserStub(t, userRepo, "sub-1", makeCandidateID())
			svc := NewApplicationService(repo, userRepo)

			got, err := svc.ApplyJob(context.Background(), "sub-1", makeJobID(), applyJobDto(nil))
			if !errors.Is(err, c.err) {
				t.Errorf("want errors.Is(., %v), got %v", c.err, err)
			}
			if got != nil {
				t.Errorf("want nil application on error, got %v", got)
			}
		})
	}
}

// --- helpers -------------------------------------------------------------

// applyJobDto is a tiny builder for ApplyRequestDto. Implemented in
// applyToJob.go to keep this file import-graph-clean.
func applyJobDto(source *string) applyJobDtoType {
	return applyJobDtoType{Source: source}
}

// entities_ErrJobNotApplicable / _ErrAlreadyApplied resolve to the entities package sentinels via package-
// level function references (defined in the use-case files so the test
// file does not import the entities package directly — the entities
// package imports valueobjects, so we keep the test imports minimal).
func entities_ErrJobNotApplicable() error { return sentinelJobNotApplicable }
func entities_ErrAlreadyApplied() error   { return sentinelAlreadyApplied }

// valueobjects_ErrInvalidSource resolves to the valueobjects package sentinel.
func valueobjects_ErrInvalidSource() error { return sentinelInvalidSource }
