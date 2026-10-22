package postgres

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/entities"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/valueobjects"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// This transactional fake probes adapter orchestration, not PostgreSQL locking.
// The integration suite separately exercises the real statements and races.
type memberMutationDB struct {
	pgx.Tx
	companyID, targetID                              uuid.UUID
	role                                             string
	owners                                           int64
	exists, locked, committed, rolledBack            bool
	beginErr, lockErr, countErr, writeErr, commitErr error
	writes                                           int
	beforeRole                                       string
	beforeExists                                     bool
	isolation                                        pgx.TxIsoLevel
}

func (s *memberMutationDB) Begin(context.Context) (pgx.Tx, error) {
	s.beforeRole, s.beforeExists = s.role, s.exists
	return s, s.beginErr
}
func (s *memberMutationDB) BeginTx(ctx context.Context, opts pgx.TxOptions) (pgx.Tx, error) {
	s.isolation = opts.IsoLevel
	return s.Begin(ctx)
}

func (s *memberMutationDB) Commit(context.Context) error {
	s.committed = s.commitErr == nil
	return s.commitErr
}
func (s *memberMutationDB) Rollback(context.Context) error {
	s.rolledBack = true
	if !s.committed {
		s.role, s.exists = s.beforeRole, s.beforeExists
	}
	return nil
}

type memberMutationRow struct {
	value any
	err   error
}

func (r memberMutationRow) Scan(dest ...any) error {
	if r.err != nil {
		return r.err
	}
	switch d := dest[0].(type) {
	case *uuid.UUID:
		*d = r.value.(uuid.UUID)
	case *string:
		*d = r.value.(string)
	case *int64:
		*d = r.value.(int64)
	}
	return nil
}
func (s *memberMutationDB) QueryRow(_ context.Context, sql string, args ...any) pgx.Row {
	switch {
	case strings.Contains(sql, "FOR UPDATE"):
		s.locked = true
		return memberMutationRow{s.companyID, s.lockErr}
	case strings.Contains(sql, "count(*)"):
		return memberMutationRow{s.owners, s.countErr}
	default:
		if !s.exists || args[0] != s.targetID || args[1] != s.companyID {
			return memberMutationRow{err: pgx.ErrNoRows}
		}
		return memberMutationRow{value: s.role}
	}
}
func (s *memberMutationDB) Exec(_ context.Context, sql string, args ...any) (pgconn.CommandTag, error) {
	if s.writeErr != nil {
		return pgconn.CommandTag{}, s.writeErr
	}
	if !s.exists || args[0] != s.targetID || args[1] != s.companyID {
		return pgconn.NewCommandTag("UPDATE 0"), nil
	}
	s.writes++
	if strings.Contains(sql, "DELETE FROM") {
		s.exists = false
		return pgconn.NewCommandTag("DELETE 1"), nil
	}
	s.role = args[2].(string)
	return pgconn.NewCommandTag("UPDATE 1"), nil
}

func TestMemberMutationGuard(t *testing.T) {
	for _, tc := range []struct {
		name, role               string
		owners                   int64
		remove, foreign, missing bool
		next                     valueobjects.MemberRole
		want                     error
	}{
		{name: "demote only owner", role: "owner", owners: 1, next: valueobjects.RecruiterRole, want: entities.ErrLastOwner},
		{name: "remove only owner", role: "owner", owners: 1, remove: true, want: entities.ErrLastOwner},
		{name: "demote with another owner", role: "owner", owners: 2, next: valueobjects.RecruiterRole},
		{name: "remove with another owner", role: "owner", owners: 2, remove: true},
		{name: "keep only owner", role: "owner", owners: 1, next: valueobjects.OwnerRole},
		{name: "promote non-owner", role: "recruiter", owners: 1, next: valueobjects.OwnerRole},
		{name: "update non-owner", role: "recruiter", owners: 1, next: valueobjects.RecruiterRole},
		{name: "remove non-owner", role: "recruiter", owners: 1, remove: true},
		{name: "foreign update wins over last owner", role: "owner", owners: 1, foreign: true, next: valueobjects.RecruiterRole, want: entities.ErrMemberNotFound},
		{name: "foreign remove wins over last owner", role: "owner", owners: 1, foreign: true, remove: true, want: entities.ErrMemberNotFound},
		{name: "unknown update", role: "owner", owners: 1, missing: true, next: valueobjects.RecruiterRole, want: entities.ErrMemberNotFound},
		{name: "unknown remove", role: "owner", owners: 1, missing: true, remove: true, want: entities.ErrMemberNotFound},
	} {
		t.Run(tc.name, func(t *testing.T) {
			state := &memberMutationDB{companyID: uuid.New(), targetID: uuid.New(), role: tc.role, owners: tc.owners, exists: !tc.missing}
			repo := NewCompanyMemberRepository(state)
			companyID := state.companyID
			if tc.foreign {
				companyID = uuid.New()
			}
			var err error
			if tc.remove {
				err = repo.Remove(context.Background(), state.targetID, companyID)
			} else {
				err = repo.UpdateRole(context.Background(), state.targetID, companyID, tc.next)
			}
			if !errors.Is(err, tc.want) {
				t.Fatalf("error = %v, want %v", err, tc.want)
			}
			if tc.want != nil {
				if state.writes != 0 || state.role != tc.role || state.exists != !tc.missing || state.committed {
					t.Fatal("rejected mutation changed stored state")
				}
				return
			}
			if state.isolation != pgx.ReadCommitted {
				t.Fatal("mutation must explicitly use READ COMMITTED")
			}
			if !state.locked || !state.committed {
				t.Fatal("mutation must lock company and commit its transaction")
			}
			if tc.remove {
				if state.exists {
					t.Fatal("membership not removed")
				}
			} else if state.role != tc.next.String() {
				t.Fatalf("role = %s", state.role)
			}
		})
	}
}

func TestMemberMutationFailuresRollback(t *testing.T) {
	boom := errors.New("database unavailable")
	for _, tc := range []struct {
		name   string
		inject func(*memberMutationDB)
		want   error
	}{
		{"begin", func(s *memberMutationDB) { s.beginErr = boom }, boom},
		{"lock", func(s *memberMutationDB) { s.lockErr = boom }, boom},
		{"missing company", func(s *memberMutationDB) { s.lockErr = pgx.ErrNoRows }, entities.ErrMemberNotFound},
		{"count", func(s *memberMutationDB) { s.countErr = boom }, boom},
		{"write", func(s *memberMutationDB) { s.writeErr = boom }, boom},
		{"commit", func(s *memberMutationDB) { s.commitErr = boom }, boom},
	} {
		for _, remove := range []bool{false, true} {
			name := tc.name + "/update"
			if remove {
				name = tc.name + "/remove"
			}
			t.Run(name, func(t *testing.T) {
				state := &memberMutationDB{companyID: uuid.New(), targetID: uuid.New(), role: "owner", owners: 2, exists: true}
				tc.inject(state)
				repo := NewCompanyMemberRepository(state)
				var err error
				if remove {
					err = repo.Remove(context.Background(), state.targetID, state.companyID)
				} else {
					err = repo.UpdateRole(context.Background(), state.targetID, state.companyID, valueobjects.RecruiterRole)
				}
				if !errors.Is(err, tc.want) {
					t.Fatalf("error = %v, want %v", err, tc.want)
				}
				if state.committed || state.role != "owner" || !state.exists {
					t.Fatal("failed transaction changed stored membership")
				}
				if tc.name != "begin" && !state.rolledBack {
					t.Fatal("transaction not rolled back")
				}
			})
		}
	}
}
