package postgres

import (
	"errors"
	"fmt"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/entities"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

func TestMapCreateError_NilReturnsNil(t *testing.T) {
	if got := mapCreateError(nil); got != nil {
		t.Errorf("expected nil for nil input, got: %v", got)
	}
}

func TestMapCreateError_23505OnCognitoSubBranch(t *testing.T) {
	pgErr := &pgconn.PgError{
		Code:           "23505",
		Message:        "duplicate key value violates unique constraint \"users_cognito_sub_unique\"",
		ConstraintName: "users_cognito_sub_unique",
	}
	got := mapCreateError(pgErr)
	if !errors.Is(got, entities.ErrUserExists) {
		t.Errorf("expected ErrUserExists, got: %v", got)
	}
}

func TestMapCreateError_23505OnEmailBranch(t *testing.T) {
	pgErr := &pgconn.PgError{
		Code:           "23505",
		Message:        "duplicate key value violates unique constraint \"users_email_unique\"",
		ConstraintName: "users_email_unique",
	}
	got := mapCreateError(pgErr)
	if !errors.Is(got, entities.ErrEmailTaken) {
		t.Errorf("expected ErrEmailTaken, got: %v", got)
	}
}

func TestMapCreateError_23505UnknownConstraintFallsThrough(t *testing.T) {
	pgErr := &pgconn.PgError{
		Code:           "23505",
		Message:        "duplicate key value violates unique constraint \"some_other_unique\"",
		ConstraintName: "some_other_unique",
	}
	got := mapCreateError(pgErr)
	if !errors.Is(got, pgErr) {
		t.Errorf("expected original pg error to fall through, got: %v", got)
	}
}

func TestMapCreateError_Wrapped23505OnCognitoSub(t *testing.T) {
	pgErr := &pgconn.PgError{
		Code:           "23505",
		ConstraintName: "users_cognito_sub_unique",
	}
	wrapped := fmt.Errorf("repo: %w", pgErr)
	got := mapCreateError(wrapped)
	if !errors.Is(got, entities.ErrUserExists) {
		t.Errorf("expected ErrUserExists via wrapped pgErr, got: %v", got)
	}
}

func TestMapCreateError_ErrNoRowsMapsToErrUserNotFound(t *testing.T) {
	got := mapCreateError(pgx.ErrNoRows)
	if !errors.Is(got, entities.ErrUserNotFound) {
		t.Errorf("expected ErrUserNotFound for pgx.ErrNoRows, got: %v", got)
	}
}

func TestMapCreateError_WrappedErrNoRows(t *testing.T) {
	wrapped := fmt.Errorf("GetById: %w", pgx.ErrNoRows)
	got := mapCreateError(wrapped)
	if !errors.Is(got, entities.ErrUserNotFound) {
		t.Errorf("expected ErrUserNotFound for wrapped pgx.ErrNoRows, got: %v", got)
	}
}

func TestMapCreateError_PassThroughUnrelatedPgError(t *testing.T) {
	pgErr := &pgconn.PgError{
		Code:    "42P01", // undefined_table
		Message: "relation \"missing\" does not exist",
	}
	got := mapCreateError(pgErr)
	if !errors.Is(got, pgErr) {
		t.Errorf("expected pass-through, got: %v", got)
	}
}

func TestMapCreateError_PassThroughNonPgError(t *testing.T) {
	in := errors.New("dial tcp: connection refused")
	got := mapCreateError(in)
	if got == nil {
		t.Fatal("expected pass-through, got nil")
	}
	if errors.Is(got, entities.ErrUserExists) || errors.Is(got, entities.ErrEmailTaken) || errors.Is(got, entities.ErrUserNotFound) {
		t.Errorf("must not coerce non-pg error to any domain sentinel, got: %v", got)
	}
}
