package localbootstrap

import (
	"context"
	"errors"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/application/usecases"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/entities"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/valueobjects"
	"github.com/google/uuid"
)

var (
	idNew     = uuid.MustParse("0193f2c0-0000-7000-8000-000000000001")
	idExisted = uuid.MustParse("0193f2c0-0000-7000-8000-000000000002")
)

func testUser(t *testing.T, id uuid.UUID, cognitoSub, email, name string, userType valueobjects.UserType) *entities.User {
	t.Helper()
	emailVO, err := valueobjects.NewEmail(email)
	if err != nil {
		t.Fatalf("NewEmail(%q): %v", email, err)
	}
	nameVO, err := valueobjects.NewFullName(name)
	if err != nil {
		t.Fatalf("NewFullName(%q): %v", name, err)
	}
	return &entities.User{
		ID:         id,
		CognitoSub: cognitoSub,
		Email:      emailVO,
		FullName:   nameVO,
		UserType:   userType,
	}
}

type fakeRowStore struct {
	existing    *entities.User
	existingErr error
	createFunc  func(user *entities.User) (*entities.User, error)

	lookupCalls int
	createCalls int
}

func (f *fakeRowStore) GetByCognitoSub(_ context.Context, _ string) (*entities.User, error) {
	f.lookupCalls++
	if f.existingErr != nil {
		return nil, f.existingErr
	}
	if f.existing == nil {
		return nil, entities.ErrUserNotFound
	}
	return f.existing, nil
}

func (f *fakeRowStore) GetByID(_ context.Context, _ uuid.UUID) (*entities.User, error) {
	return nil, entities.ErrUserNotFound
}

func (f *fakeRowStore) Create(_ context.Context, user *entities.User) (*entities.User, error) {
	f.createCalls++
	if f.createFunc != nil {
		return f.createFunc(user)
	}
	return user, nil
}

func TestCompatibleUserStore_Create(t *testing.T) {
	t.Run("new row is created", func(t *testing.T) {
		store := &fakeRowStore{}
		adapter := NewCompatibleUserStore(store)
		user := testUser(t, idNew, "sub-1", "user@example.com", "Ada Lovelace", valueobjects.UserRecruiter)

		got, err := adapter.Create(context.Background(), user)
		if err != nil {
			t.Fatalf("Create: %v", err)
		}
		if got.ID != idNew {
			t.Errorf("Create returned ID %s, want the new row %s", got.ID, idNew)
		}
		if store.createCalls != 1 {
			t.Errorf("create calls = %d, want 1", store.createCalls)
		}
	})

	t.Run("compatible existing row is already_exists without a write", func(t *testing.T) {
		existing := testUser(t, idExisted, "sub-1", "user@example.com", "Ada Lovelace", valueobjects.UserRecruiter)
		store := &fakeRowStore{existing: existing}
		adapter := NewCompatibleUserStore(store)
		user := testUser(t, idNew, "sub-1", "user@example.com", "Ada Lovelace", valueobjects.UserRecruiter)

		_, err := adapter.Create(context.Background(), user)
		if !errors.Is(err, ErrAlreadyExists) {
			t.Fatalf("Create error = %v, want ErrAlreadyExists", err)
		}
		if store.createCalls != 0 {
			t.Errorf("create calls = %d, want 0 for an existing compatible row", store.createCalls)
		}
	})

	t.Run("incompatible existing name stops", func(t *testing.T) {
		existing := testUser(t, idExisted, "sub-1", "user@example.com", "Someone Else", valueobjects.UserRecruiter)
		store := &fakeRowStore{existing: existing}
		adapter := NewCompatibleUserStore(store)
		user := testUser(t, idNew, "sub-1", "user@example.com", "Ada Lovelace", valueobjects.UserRecruiter)

		_, err := adapter.Create(context.Background(), user)
		if !errors.Is(err, ErrIdentityConflict) {
			t.Fatalf("Create error = %v, want ErrIdentityConflict", err)
		}
		if store.createCalls != 0 {
			t.Errorf("create calls = %d, want 0 on conflict", store.createCalls)
		}
	})

	t.Run("incompatible existing email stops", func(t *testing.T) {
		existing := testUser(t, idExisted, "sub-1", "other@example.com", "Ada Lovelace", valueobjects.UserRecruiter)
		store := &fakeRowStore{existing: existing}
		adapter := NewCompatibleUserStore(store)
		user := testUser(t, idNew, "sub-1", "user@example.com", "Ada Lovelace", valueobjects.UserRecruiter)

		if _, err := adapter.Create(context.Background(), user); !errors.Is(err, ErrIdentityConflict) {
			t.Fatalf("Create error = %v, want ErrIdentityConflict", err)
		}
	})

	t.Run("incompatible existing type stops", func(t *testing.T) {
		existing := testUser(t, idExisted, "sub-1", "user@example.com", "Ada Lovelace", valueobjects.UserCandidate)
		store := &fakeRowStore{existing: existing}
		adapter := NewCompatibleUserStore(store)
		user := testUser(t, idNew, "sub-1", "user@example.com", "Ada Lovelace", valueobjects.UserRecruiter)

		if _, err := adapter.Create(context.Background(), user); !errors.Is(err, ErrIdentityConflict) {
			t.Fatalf("Create error = %v, want ErrIdentityConflict", err)
		}
	})

	t.Run("insert race returning a compatible row is already_exists", func(t *testing.T) {
		existing := testUser(t, idExisted, "sub-1", "user@example.com", "Ada Lovelace", valueobjects.UserRecruiter)
		store := &fakeRowStore{createFunc: func(*entities.User) (*entities.User, error) { return existing, nil }}
		adapter := NewCompatibleUserStore(store)
		user := testUser(t, idNew, "sub-1", "user@example.com", "Ada Lovelace", valueobjects.UserRecruiter)

		if _, err := adapter.Create(context.Background(), user); !errors.Is(err, ErrAlreadyExists) {
			t.Fatalf("Create error = %v, want ErrAlreadyExists", err)
		}
	})

	t.Run("insert race returning an incompatible row stops", func(t *testing.T) {
		existing := testUser(t, idExisted, "sub-1", "user@example.com", "Someone Else", valueobjects.UserRecruiter)
		store := &fakeRowStore{createFunc: func(*entities.User) (*entities.User, error) { return existing, nil }}
		adapter := NewCompatibleUserStore(store)
		user := testUser(t, idNew, "sub-1", "user@example.com", "Ada Lovelace", valueobjects.UserRecruiter)

		if _, err := adapter.Create(context.Background(), user); !errors.Is(err, ErrIdentityConflict) {
			t.Fatalf("Create error = %v, want ErrIdentityConflict", err)
		}
	})

	t.Run("ambiguous lookup error propagates without a write", func(t *testing.T) {
		ambiguous := errors.New("connection reset")
		store := &fakeRowStore{existingErr: ambiguous}
		adapter := NewCompatibleUserStore(store)
		user := testUser(t, idNew, "sub-1", "user@example.com", "Ada Lovelace", valueobjects.UserRecruiter)

		_, err := adapter.Create(context.Background(), user)
		if !errors.Is(err, ambiguous) {
			t.Fatalf("Create error = %v, want the underlying error", err)
		}
		if store.createCalls != 0 {
			t.Errorf("create calls = %d, want 0 after an ambiguous lookup", store.createCalls)
		}
	})

	t.Run("create error propagates without retry", func(t *testing.T) {
		ambiguous := errors.New("write timeout")
		store := &fakeRowStore{createFunc: func(*entities.User) (*entities.User, error) { return nil, ambiguous }}
		adapter := NewCompatibleUserStore(store)
		user := testUser(t, idNew, "sub-1", "user@example.com", "Ada Lovelace", valueobjects.UserRecruiter)

		_, err := adapter.Create(context.Background(), user)
		if !errors.Is(err, ambiguous) {
			t.Fatalf("Create error = %v, want the underlying error", err)
		}
		if store.createCalls != 1 {
			t.Errorf("create calls = %d, want exactly 1 (no retry)", store.createCalls)
		}
	})
}

func TestUserServiceCreator_Create(t *testing.T) {
	cmd := CreateUserCommand{
		CognitoSub: "sub-1",
		Email:      "user@example.com",
		FullName:   "Ada Lovelace",
		UserType:   "recruiter",
	}

	t.Run("created", func(t *testing.T) {
		store := &fakeRowStore{}
		creator := NewUserServiceCreator(usecases.NewUserService(NewCompatibleUserStore(store)))

		code, err := creator.Create(context.Background(), cmd)
		if err != nil {
			t.Fatalf("Create: %v", err)
		}
		if code != CreateCodeCreated {
			t.Errorf("code = %q, want %q", code, CreateCodeCreated)
		}
	})

	t.Run("already exists is a success outcome", func(t *testing.T) {
		existing := testUser(t, idExisted, "sub-1", "user@example.com", "Ada Lovelace", valueobjects.UserRecruiter)
		store := &fakeRowStore{existing: existing}
		creator := NewUserServiceCreator(usecases.NewUserService(NewCompatibleUserStore(store)))

		code, err := creator.Create(context.Background(), cmd)
		if err != nil {
			t.Fatalf("Create: %v", err)
		}
		if code != CreateCodeAlreadyExists {
			t.Errorf("code = %q, want %q", code, CreateCodeAlreadyExists)
		}
	})

	t.Run("identity conflict stops", func(t *testing.T) {
		existing := testUser(t, idExisted, "sub-1", "other@example.com", "Ada Lovelace", valueobjects.UserRecruiter)
		store := &fakeRowStore{existing: existing}
		creator := NewUserServiceCreator(usecases.NewUserService(NewCompatibleUserStore(store)))

		if _, err := creator.Create(context.Background(), cmd); !errors.Is(err, ErrIdentityConflict) {
			t.Fatalf("Create error = %v, want ErrIdentityConflict", err)
		}
	})

	t.Run("email taken maps to identity conflict", func(t *testing.T) {
		store := &fakeRowStore{createFunc: func(*entities.User) (*entities.User, error) { return nil, entities.ErrEmailTaken }}
		creator := NewUserServiceCreator(usecases.NewUserService(NewCompatibleUserStore(store)))

		if _, err := creator.Create(context.Background(), cmd); !errors.Is(err, ErrIdentityConflict) {
			t.Fatalf("Create error = %v, want ErrIdentityConflict", err)
		}
	})

	t.Run("ambiguous create error propagates", func(t *testing.T) {
		ambiguous := errors.New("write timeout")
		store := &fakeRowStore{createFunc: func(*entities.User) (*entities.User, error) { return nil, ambiguous }}
		creator := NewUserServiceCreator(usecases.NewUserService(NewCompatibleUserStore(store)))

		if _, err := creator.Create(context.Background(), cmd); !errors.Is(err, ambiguous) {
			t.Fatalf("Create error = %v, want the underlying error", err)
		}
	})

	t.Run("invalid input fails validation before persistence", func(t *testing.T) {
		store := &fakeRowStore{}
		creator := NewUserServiceCreator(usecases.NewUserService(NewCompatibleUserStore(store)))
		bad := cmd
		bad.Email = "not-an-email"

		if _, err := creator.Create(context.Background(), bad); err == nil {
			t.Fatal("Create with an invalid email returned nil error")
		}
		if store.lookupCalls != 0 || store.createCalls != 0 {
			t.Errorf("persistence was touched on invalid input: lookups=%d creates=%d", store.lookupCalls, store.createCalls)
		}
	})
}
