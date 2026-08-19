package usecases

import (
	"context"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/candidates/application/dtos"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/candidates/domain/entities"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/candidates/domain/valueobjects"
	identityentities "github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/entities"
	"github.com/google/uuid"
)

// --- fakes -----------------------------------------------------------------

type stubCandidateRepository struct {
	mu sync.Mutex

	upserted       *entities.CandidateProfile
	upsertErr      error
	getByIDOut     *entities.CandidateProfile
	getByIDErr     error
	listOut        []entities.Language
	listErr        error
	replacedWith   []entities.Language
	replaceErr     error
	lastReplaceFor uuid.UUID

	upsertCalls  int
	replaceCalls int
	getByIDCalls int
}

func (s *stubCandidateRepository) UpsertProfile(_ context.Context, p *entities.CandidateProfile) (*entities.CandidateProfile, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.upsertCalls++
	if s.upsertErr != nil {
		return nil, s.upsertErr
	}
	s.upserted = p
	return p, nil
}

func (s *stubCandidateRepository) GetProfileByUserID(_ context.Context, _ uuid.UUID) (*entities.CandidateProfile, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.getByIDCalls++
	if s.getByIDErr != nil {
		return nil, s.getByIDErr
	}
	if s.getByIDOut != nil {
		return s.getByIDOut, nil
	}
	return nil, entities.ErrProfileNotFound
}

func (s *stubCandidateRepository) ListLanguagesByUserID(_ context.Context, _ uuid.UUID) ([]entities.Language, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.listErr != nil {
		return nil, s.listErr
	}
	if s.listOut == nil {
		return []entities.Language{}, nil
	}
	out := make([]entities.Language, len(s.listOut))
	copy(out, s.listOut)
	return out, nil
}

func (s *stubCandidateRepository) ReplaceLanguagesByUserID(_ context.Context, userID uuid.UUID, langs []entities.Language) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.replaceCalls++
	if s.replaceErr != nil {
		return s.replaceErr
	}
	s.lastReplaceFor = userID
	s.replacedWith = make([]entities.Language, len(langs))
	copy(s.replacedWith, langs)
	return nil
}

type stubUserRepository struct {
	mu         sync.Mutex
	resolved   *identityentities.User
	resolveErr error
	getCalls   int
}

func (s *stubUserRepository) GetByCognitoSub(_ context.Context, sub string) (*identityentities.User, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.getCalls++
	if s.resolveErr != nil {
		return nil, s.resolveErr
	}
	if s.resolved == nil {
		return nil, identityentities.ErrUserNotFound
	}
	return s.resolved, nil
}

// Create and GetByID are not exercised by the candidates use cases; the
// stub returns "not implemented" so any accidental call surfaces as a
// test failure rather than a silent nil dereference.
func (s *stubUserRepository) Create(_ context.Context, _ *identityentities.User) (*identityentities.User, error) {
	return nil, errors.New("stubUserRepository.Create: not used by candidates tests")
}

func (s *stubUserRepository) GetByID(_ context.Context, _ uuid.UUID) (*identityentities.User, error) {
	return nil, errors.New("stubUserRepository.GetByID: not used by candidates tests")
}

// Compile-time guard: UserRepository surface used by the candidates slice.
var _ interface {
	GetByCognitoSub(ctx context.Context, sub string) (*identityentities.User, error)
	Create(ctx context.Context, u *identityentities.User) (*identityentities.User, error)
	GetByID(ctx context.Context, id uuid.UUID) (*identityentities.User, error)
} = (*stubUserRepository)(nil)

// Compile-time guard: CandidateRepository surface.
var _ interface {
	UpsertProfile(ctx context.Context, p *entities.CandidateProfile) (*entities.CandidateProfile, error)
	GetProfileByUserID(ctx context.Context, id uuid.UUID) (*entities.CandidateProfile, error)
	ListLanguagesByUserID(ctx context.Context, id uuid.UUID) ([]entities.Language, error)
	ReplaceLanguagesByUserID(ctx context.Context, id uuid.UUID, langs []entities.Language) error
} = (*stubCandidateRepository)(nil)

// --- helpers ---------------------------------------------------------------

func makeUser(id uuid.UUID, sub string) *identityentities.User {
	return &identityentities.User{ID: id, CognitoSub: sub}
}

func newSvc(cRepo *stubCandidateRepository, uRepo *stubUserRepository) *CandidateService {
	return NewCandidateService(cRepo, uRepo)
}

// --- tests -----------------------------------------------------------------

// TestGetMyProfile_Found covers the spec scenario "GET returns the caller's
// profile": the use case resolves the JWT sub to a users.id, fetches the
// profile, and returns it to the HTTP layer.
func TestGetMyProfile_Found(t *testing.T) {
	userID := uuid.New()
	row, err := entities.NewCandidateProfile(userID.String(), entities.CandidateProfileInput{
		Skills: []string{"go", "aws"},
	})
	if err != nil {
		t.Fatalf("setup: NewCandidateProfile: %v", err)
	}
	row.Phone = strPtr("+52 55 1234 5678")
	row.ProfessionalTitle = strPtr("Senior Backend Engineer")

	cRepo := &stubCandidateRepository{getByIDOut: row}
	uRepo := &stubUserRepository{resolved: makeUser(userID, "sub-abc")}
	svc := newSvc(cRepo, uRepo)

	got, err := svc.GetMyProfile(context.Background(), "sub-abc")
	if err != nil {
		t.Fatalf("expected no error, got: %v", err)
	}
	if got == nil {
		t.Fatal("expected non-nil profile")
	}
	if got.UserID != userID.String() {
		t.Errorf("UserID: want %v, got %v", userID, got.UserID)
	}
}

// TestGetMyProfile_UnknownSubjectIsUnauthorized covers the spec scenario
// "unknown cognito_sub is not 5xx": a valid JWT whose sub doesn't match
// any live users.cognito_sub must surface as ErrUnknownSubject so the HTTP
// layer can map it to 401. NO 5xx ever.
func TestGetMyProfile_UnknownSubjectIsUnauthorized(t *testing.T) {
	cRepo := &stubCandidateRepository{}
	uRepo := &stubUserRepository{resolveErr: identityentities.ErrUserNotFound}
	svc := newSvc(cRepo, uRepo)

	_, err := svc.GetMyProfile(context.Background(), "unknown-sub")
	if err == nil {
		t.Fatal("expected ErrUnknownSubject, got nil")
	}
	if !errors.Is(err, ErrUnknownSubject) {
		t.Errorf("expected ErrUnknownSubject, got: %v", err)
	}
}

// TestGetMyProfile_NoProfileReturnsNotFound covers the spec scenario "GET
// without a profile returns 404".
func TestGetMyProfile_NoProfileReturnsNotFound(t *testing.T) {
	userID := uuid.New()
	cRepo := &stubCandidateRepository{getByIDErr: entities.ErrProfileNotFound}
	uRepo := &stubUserRepository{resolved: makeUser(userID, "sub-abc")}
	svc := newSvc(cRepo, uRepo)

	_, err := svc.GetMyProfile(context.Background(), "sub-abc")
	if !errors.Is(err, entities.ErrProfileNotFound) {
		t.Errorf("expected ErrProfileNotFound, got: %v", err)
	}
}

// TestUpsertMyProfile_CreatesProfile covers the spec scenario "PUT creates
// on first call". After the upsert the repository received the canonical
// (lowercased) skills list — proving the use case enforces normalization
// even if a caller bypasses the HTTP layer.
func TestUpsertMyProfile_CreatesProfile(t *testing.T) {
	userID := uuid.New()
	cRepo := &stubCandidateRepository{}
	uRepo := &stubUserRepository{resolved: makeUser(userID, "sub-abc")}
	svc := newSvc(cRepo, uRepo)

	phone := "+52 55 1234 5678"
	title := "Senior Backend Engineer"
	edu := "bachelor"
	period := "monthly"
	dto := dtos.UpsertMyProfileDto{
		Phone:                &phone,
		ProfessionalTitle:    &title,
		EducationLevel:       &edu,
		ExpectedSalaryPeriod: &period,
		Skills:               []string{"Go", "AWS"},
	}

	got, err := svc.UpsertMyProfile(context.Background(), "sub-abc", dto)
	if err != nil {
		t.Fatalf("expected no error, got: %v", err)
	}
	if got == nil {
		t.Fatal("expected non-nil profile")
	}
	if cRepo.upserted == nil {
		t.Fatal("expected repository UpsertProfile to be called")
	}
	if got.UserID != userID.String() {
		t.Errorf("UserID: want %v, got %v", userID, got.UserID)
	}
	// Skills normalization is the use case's contract.
	wantSkills := []string{"go", "aws"}
	if strings.Join(cRepo.upserted.Skills, ",") != strings.Join(wantSkills, ",") {
		t.Errorf("Skills: want %v, got %v", wantSkills, cRepo.upserted.Skills)
	}
	if cRepo.upserted.EducationLevel == nil || *cRepo.upserted.EducationLevel != valueobjects.Bachelor {
		t.Errorf("EducationLevel: want Bachelor, got %v", cRepo.upserted.EducationLevel)
	}
	if cRepo.upserted.ExpectedSalaryPeriod == nil || *cRepo.upserted.ExpectedSalaryPeriod != valueobjects.MonthlySalary {
		t.Errorf("ExpectedSalaryPeriod: want MonthlySalary, got %v", cRepo.upserted.ExpectedSalaryPeriod)
	}
}

// TestUpsertMyProfile_InvalidEnumReturns400 covers the spec scenarios
// "invalid education_level is rejected" / "invalid salary_period is
// rejected". The use case must NOT touch the repository on these failures.
func TestUpsertMyProfile_InvalidEducationReturns400(t *testing.T) {
	userID := uuid.New()
	cRepo := &stubCandidateRepository{}
	uRepo := &stubUserRepository{resolved: makeUser(userID, "sub-abc")}
	svc := newSvc(cRepo, uRepo)

	badEdu := "vocational"
	_, err := svc.UpsertMyProfile(context.Background(), "sub-abc", dtos.UpsertMyProfileDto{
		EducationLevel: &badEdu,
	})
	if !errors.Is(err, valueobjects.ErrInvalidEducationLevel) {
		t.Errorf("expected ErrInvalidEducationLevel, got: %v", err)
	}
	if cRepo.upsertCalls != 0 {
		t.Errorf("repository must not be invoked on validation failure, got %d calls", cRepo.upsertCalls)
	}
}

func TestUpsertMyProfile_InvalidSalaryPeriodReturns400(t *testing.T) {
	userID := uuid.New()
	cRepo := &stubCandidateRepository{}
	uRepo := &stubUserRepository{resolved: makeUser(userID, "sub-abc")}
	svc := newSvc(cRepo, uRepo)

	badPeriod := "weekly"
	_, err := svc.UpsertMyProfile(context.Background(), "sub-abc", dtos.UpsertMyProfileDto{
		ExpectedSalaryPeriod: &badPeriod,
	})
	if !errors.Is(err, valueobjects.ErrInvalidSalaryPeriod) {
		t.Errorf("expected ErrInvalidSalaryPeriod, got: %v", err)
	}
	if cRepo.upsertCalls != 0 {
		t.Errorf("repository must not be invoked on validation failure, got %d calls", cRepo.upsertCalls)
	}
}

// TestUpsertMyProfile_UnknownSubjectIsUnauthorized covers the IDOR
// invariant: even when the repository is willing, a missing sub must NOT
// fall through to a 5xx. The use case catches it at the edge.
func TestUpsertMyProfile_UnknownSubjectIsUnauthorized(t *testing.T) {
	cRepo := &stubCandidateRepository{}
	uRepo := &stubUserRepository{resolveErr: identityentities.ErrUserNotFound}
	svc := newSvc(cRepo, uRepo)

	_, err := svc.UpsertMyProfile(context.Background(), "missing-sub", dtos.UpsertMyProfileDto{})
	if !errors.Is(err, ErrUnknownSubject) {
		t.Errorf("expected ErrUnknownSubject, got: %v", err)
	}
	if cRepo.upsertCalls != 0 {
		t.Errorf("repository must not be invoked when sub is unknown, got %d calls", cRepo.upsertCalls)
	}
}

// TestUpsertMyProfile_IsIdempotent covers the spec scenario "PUT is
// idempotent on repeat": a second PUT with different data must succeed
// and the repository must receive the latest body. Database-level
// uniqueness (no second row, ON CONFLICT DO UPDATE) lives in the
// postgres adapter — at the use case layer we only guarantee "calls
// UpsertProfile with the latest payload, every time".
func TestUpsertMyProfile_IsIdempotent(t *testing.T) {
	userID := uuid.New()
	cRepo := &stubCandidateRepository{}
	uRepo := &stubUserRepository{resolved: makeUser(userID, "sub-abc")}
	svc := newSvc(cRepo, uRepo)

	// First PUT creates the row.
	firstTitle := "First Title"
	_, err := svc.UpsertMyProfile(context.Background(), "sub-abc", dtos.UpsertMyProfileDto{
		ProfessionalTitle: &firstTitle,
	})
	if err != nil {
		t.Fatalf("first upsert: %v", err)
	}

	// Second PUT with new payload must be accepted; the use case forwards
	// the latest body to the repository, and the persisted row reflects it.
	secondTitle := "Second Title"
	secondEdu := "master"
	got, err := svc.UpsertMyProfile(context.Background(), "sub-abc", dtos.UpsertMyProfileDto{
		ProfessionalTitle: &secondTitle,
		EducationLevel:    &secondEdu,
	})
	if err != nil {
		t.Fatalf("second upsert: %v", err)
	}

	if cRepo.upsertCalls != 2 {
		t.Errorf("expected 2 upsert calls, got %d", cRepo.upsertCalls)
	}
	if cRepo.upserted == nil || cRepo.upserted.ProfessionalTitle == nil ||
		*cRepo.upserted.ProfessionalTitle != secondTitle {
		t.Errorf("repo saw title: want %q, got %v", secondTitle, cRepo.upserted.ProfessionalTitle)
	}
	if cRepo.upserted.EducationLevel == nil || *cRepo.upserted.EducationLevel != valueobjects.Master {
		t.Errorf("repo saw EducationLevel: want Master, got %v", cRepo.upserted.EducationLevel)
	}
	if got == nil || got.ProfessionalTitle == nil || *got.ProfessionalTitle != secondTitle {
		t.Errorf("returned profile must reflect the latest title, got %v", got)
	}
}

// TestReplaceMyLanguages_ReplacesAtomic covers the spec scenario "PUT
// replaces the full list atomically". The use case hands the canonical
// (lowercased) list to the repository in one call.
func TestReplaceMyLanguages_ReplacesAtomic(t *testing.T) {
	userID := uuid.New()
	cRepo := &stubCandidateRepository{}
	uRepo := &stubUserRepository{resolved: makeUser(userID, "sub-abc")}
	svc := newSvc(cRepo, uRepo)

	dto := dtos.ReplaceMyLanguagesDto{
		Languages: []dtos.LanguageDto{
			{Name: "English", Level: "C1"},
			{Name: "French", Level: "A2"},
		},
	}

	err := svc.ReplaceMyLanguages(context.Background(), "sub-abc", dto)
	if err != nil {
		t.Fatalf("expected no error, got: %v", err)
	}
	if cRepo.replaceCalls != 1 {
		t.Errorf("expected exactly 1 replace call, got %d", cRepo.replaceCalls)
	}
	if cRepo.lastReplaceFor != userID {
		t.Errorf("expected replace for user %v, got %v", userID, cRepo.lastReplaceFor)
	}
	if len(cRepo.replacedWith) != 2 {
		t.Fatalf("expected 2 languages, got %d", len(cRepo.replacedWith))
	}
	// Names are lowercased on write (canonical form).
	wantNames := map[string]bool{"english": true, "french": true}
	for _, l := range cRepo.replacedWith {
		if !wantNames[l.Name] {
			t.Errorf("unexpected language name %q", l.Name)
		}
	}
}

// TestReplaceMyLanguages_DuplicateIsRejected covers the spec scenario
// "duplicate language in payload is rejected" at the use-case edge. The
// repository must NOT be invoked.
func TestReplaceMyLanguages_DuplicateIsRejected(t *testing.T) {
	userID := uuid.New()
	cRepo := &stubCandidateRepository{}
	uRepo := &stubUserRepository{resolved: makeUser(userID, "sub-abc")}
	svc := newSvc(cRepo, uRepo)

	dto := dtos.ReplaceMyLanguagesDto{
		Languages: []dtos.LanguageDto{
			{Name: "english", Level: "B2"},
			{Name: "english", Level: "C1"},
		},
	}

	err := svc.ReplaceMyLanguages(context.Background(), "sub-abc", dto)
	if !errors.Is(err, entities.ErrDuplicateLanguage) {
		t.Errorf("expected ErrDuplicateLanguage, got: %v", err)
	}
	if cRepo.replaceCalls != 0 {
		t.Errorf("repository must not be invoked on duplicate, got %d calls", cRepo.replaceCalls)
	}
}

// TestReplaceMyLanguages_InvalidCefrIsRejected covers the spec scenario
// "invalid CEFR level is rejected". The use case surfaces the VO error and
// does NOT touch the repository.
func TestReplaceMyLanguages_InvalidCefrIsRejected(t *testing.T) {
	userID := uuid.New()
	cRepo := &stubCandidateRepository{}
	uRepo := &stubUserRepository{resolved: makeUser(userID, "sub-abc")}
	svc := newSvc(cRepo, uRepo)

	dto := dtos.ReplaceMyLanguagesDto{
		Languages: []dtos.LanguageDto{
			{Name: "english", Level: "native"},
		},
	}

	err := svc.ReplaceMyLanguages(context.Background(), "sub-abc", dto)
	if !errors.Is(err, valueobjects.ErrInvalidCefrLevel) {
		t.Errorf("expected ErrInvalidCefrLevel, got: %v", err)
	}
	if cRepo.replaceCalls != 0 {
		t.Errorf("repository must not be invoked on invalid CEFR, got %d calls", cRepo.replaceCalls)
	}
}

// TestListMyLanguages_Found proves the GET /me/profile/languages path
// returns the entity-shaped language list. Empty result (not nil) for a
// user with no rows.
func TestListMyLanguages_Found(t *testing.T) {
	userID := uuid.New()
	cRepo := &stubCandidateRepository{listOut: []entities.Language{
		{Name: "english", Level: valueobjects.B2},
		{Name: "spanish", Level: valueobjects.C1},
	}}
	uRepo := &stubUserRepository{resolved: makeUser(userID, "sub-abc")}
	svc := newSvc(cRepo, uRepo)

	got, err := svc.ListMyLanguages(context.Background(), "sub-abc")
	if err != nil {
		t.Fatalf("expected no error, got: %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("expected 2 languages, got %d", len(got))
	}
}

// TestListMyLanguages_EmptyIsNotNil covers the "empty list, not nil"
// invariant: handlers downstream JSON-encode the result, and nil → "null"
// is a wire-format surprise.
func TestListMyLanguages_EmptyIsNotNil(t *testing.T) {
	userID := uuid.New()
	cRepo := &stubCandidateRepository{listOut: nil}
	uRepo := &stubUserRepository{resolved: makeUser(userID, "sub-abc")}
	svc := newSvc(cRepo, uRepo)

	got, err := svc.ListMyLanguages(context.Background(), "sub-abc")
	if err != nil {
		t.Fatalf("expected no error, got: %v", err)
	}
	if got == nil {
		t.Fatal("expected non-nil empty slice")
	}
	if len(got) != 0 {
		t.Errorf("expected 0 languages, got %d", len(got))
	}
}

// TestListMyLanguages_UnknownSubjectIsUnauthorized: no DB read on unknown
// sub. Mirrors the GET /me/profile contract.
func TestListMyLanguages_UnknownSubjectIsUnauthorized(t *testing.T) {
	cRepo := &stubCandidateRepository{}
	uRepo := &stubUserRepository{resolveErr: identityentities.ErrUserNotFound}
	svc := newSvc(cRepo, uRepo)

	_, err := svc.ListMyLanguages(context.Background(), "missing-sub")
	if !errors.Is(err, ErrUnknownSubject) {
		t.Errorf("expected ErrUnknownSubject, got: %v", err)
	}
}

// helper --------------------------------------------------------------------

func strPtr(s string) *string { return &s }

// Sanity check on the time import — keeps the import live even if a future
// refactor trims the test bodies.
var _ = time.Now
