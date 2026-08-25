package usecases

import (
	"context"
	"errors"
	"sync"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/domain/entities"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/domain/repositories"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/domain/valueobjects"
	auditentities "github.com/aldrichcode45/peopleflow-vacantes/internal/features/audit_events/domain/entities"
	identityentities "github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/entities"
	identityrepositories "github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/repositories"
	"github.com/google/uuid"
)

// --- stubApplicationRepo --------------------------------------------------
//
// stubApplicationRepo satisfies usecases.ApplicationRepoPort for unit tests.
// Every method is programmable (error / return) AND captures the most
// recent invocation so the test can assert side effects:
//
//	createCalls         int
//	lastCreateParams    *repositories.CreateParams
//	lastCreateEvent     *auditentities.AuditEvent
//	getByIDCalls        int
//	lastGetByIDIDs      struct{ ID, JobID, CompanyID uuid.UUID }
//	listByJobCalls      int
//	lastListByJobIDs    struct{ JobID, CompanyID uuid.UUID }
//	listByCandidateCalls int
//	lastListByCandidateID uuid.UUID
//	transitionCalls     int
//	lastTransitionArgs  struct{ ID, JobID, CompanyID uuid.UUID; From, To valueobjects.ApplicationStatus }
//	lastTransitionEvent *auditentities.AuditEvent
//
// The error fields default to nil so a fresh stub is a happy-path stub;
// tests override one error field at a time to drive the dispatcher.

type stubApplicationRepo struct {
	mu sync.Mutex

	createErr   error
	createApp   *entities.Application
	createCalls int
	lastCreate  *repositories.CreateParams
	// lastCreateEvent is the AuditEvent the use case passed to Create on the
	// most recent invocation (D7 event-intent pin).
	lastCreateEvent *auditentities.AuditEvent

	getByIDErr   error
	getByIDApp   *entities.ApplicationWithCandidate
	getByIDCalls int
	lastGetByID  struct{ ID, JobID, CompanyID uuid.UUID }

	listByJobErr   error
	listByJobApps  []entities.ApplicationWithCandidate
	listByJobCalls int
	lastListByJob  struct{ JobID, CompanyID uuid.UUID }

	listByCandidateErr   error
	listByCandidateApps  []entities.MyApplication
	listByCandidateCalls int
	lastListByCandidate  uuid.UUID

	transitionErr   error
	transitionApp   *entities.Application
	transitionCalls int
	lastTransition  struct {
		ID, JobID, CompanyID uuid.UUID
		From, To             valueobjects.ApplicationStatus
	}
	// lastTransitionEvent is the AuditEvent the use case passed to Transition
	// on the most recent invocation (D7/D8 event-intent pin).
	lastTransitionEvent *auditentities.AuditEvent
}

func (s *stubApplicationRepo) Create(ctx context.Context, p repositories.CreateParams, event auditentities.AuditEvent) (*entities.Application, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.createCalls++
	s.lastCreate = &p
	ev := event
	s.lastCreateEvent = &ev
	if s.createErr != nil {
		return nil, s.createErr
	}
	if s.createApp != nil {
		return s.createApp, nil
	}
	// Default happy-path: build a minimal entity that round-trips the input.
	row := &entities.Application{
		ID:          p.ID,
		JobID:       p.JobID,
		CandidateID: p.CandidateID,
		Status:      valueobjects.Submitted,
	}
	if p.Source != nil {
		v := *p.Source
		row.Source = &v
	}
	if p.CoverLetter != nil {
		v := *p.CoverLetter
		row.CoverLetter = &v
	}
	return row, nil
}

func (s *stubApplicationRepo) GetByID(ctx context.Context, id, jobID, companyID uuid.UUID) (*entities.ApplicationWithCandidate, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.getByIDCalls++
	s.lastGetByID.ID = id
	s.lastGetByID.JobID = jobID
	s.lastGetByID.CompanyID = companyID
	if s.getByIDErr != nil {
		return nil, s.getByIDErr
	}
	return s.getByIDApp, nil
}

func (s *stubApplicationRepo) ListByJob(ctx context.Context, jobID, companyID uuid.UUID) ([]entities.ApplicationWithCandidate, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.listByJobCalls++
	s.lastListByJob.JobID = jobID
	s.lastListByJob.CompanyID = companyID
	if s.listByJobErr != nil {
		return nil, s.listByJobErr
	}
	return s.listByJobApps, nil
}

func (s *stubApplicationRepo) ListByCandidate(ctx context.Context, candidateID uuid.UUID) ([]entities.MyApplication, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.listByCandidateCalls++
	s.lastListByCandidate = candidateID
	if s.listByCandidateErr != nil {
		return nil, s.listByCandidateErr
	}
	return s.listByCandidateApps, nil
}

func (s *stubApplicationRepo) Transition(ctx context.Context, id, jobID, companyID uuid.UUID, from, to valueobjects.ApplicationStatus, event auditentities.AuditEvent) (*entities.Application, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.transitionCalls++
	s.lastTransition.ID = id
	s.lastTransition.JobID = jobID
	s.lastTransition.CompanyID = companyID
	s.lastTransition.From = from
	s.lastTransition.To = to
	ev := event
	s.lastTransitionEvent = &ev
	if s.transitionErr != nil {
		return nil, s.transitionErr
	}
	if s.transitionApp != nil {
		return s.transitionApp, nil
	}
	row := &entities.Application{
		ID:          id,
		JobID:       jobID,
		CandidateID: uuid.Nil,
		Status:      to,
	}
	return row, nil
}

// Compile-time guard: stubApplicationRepo satisfies ApplicationRepoPort.
var _ ApplicationRepoPort = (*stubApplicationRepo)(nil)

// --- stubUserRepo ---------------------------------------------------------

// stubUserRepo satisfies identityrepositories.UserRepository. Only
// GetByCognitoSub is used by the application service; the other methods
// are stubbed out to keep the test fake minimal.
type stubUserRepo struct {
	getByCognitoSubErr   error
	getByCognitoSubUser  *identityentities.User
	getByCognitoSubCalls int
	lastSub              string
}

func (s *stubUserRepo) GetByCognitoSub(ctx context.Context, cognitoSub string) (*identityentities.User, error) {
	s.getByCognitoSubCalls++
	s.lastSub = cognitoSub
	if s.getByCognitoSubErr != nil {
		return nil, s.getByCognitoSubErr
	}
	if s.getByCognitoSubUser != nil {
		return s.getByCognitoSubUser, nil
	}
	return nil, errors.New("stubUserRepo: GetByCognitoSub not configured")
}

func (s *stubUserRepo) GetByID(ctx context.Context, id uuid.UUID) (*identityentities.User, error) {
	return nil, errors.New("stubUserRepo: GetByID not used in tests")
}

func (s *stubUserRepo) Create(ctx context.Context, user *identityentities.User) (*identityentities.User, error) {
	return nil, errors.New("stubUserRepo: Create not used in tests")
}

// Compile-time guard: stubUserRepo satisfies identityrepositories.UserRepository.
var _ identityrepositories.UserRepository = (*stubUserRepo)(nil)
