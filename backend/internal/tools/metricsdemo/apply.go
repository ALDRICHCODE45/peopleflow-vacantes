package metricsdemo

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// Beginner opens the transaction Apply and Remove run in (a *pgxpool.Pool).
type Beginner interface {
	BeginTx(ctx context.Context, opts pgx.TxOptions) (pgx.Tx, error)
}

// Accounts are the emails of the three accounts the user registered in the
// app (employer accounts, not yet in any company).
type Accounts struct {
	OwnerEmail, StakeholderEmail, RecruiterEmail string
}

// Applied summarizes an apply.
type Applied struct {
	Company    uuid.UUID
	Statements int
	Removed    Removed // what the refresh replaced
}

// Removed counts the rows deleted per table, in deletion order.
type Removed []TableCount

type TableCount struct {
	Table string
	Rows  int64
}

// Total is every deleted row.
func (r Removed) Total() int64 {
	var n int64
	for _, c := range r {
		n += c.Rows
	}
	return n
}

// ErrAccount is a refused account (missing, a candidate, or a member of
// another company); nothing was written.
var ErrAccount = errors.New("account refused")

// Apply creates the demo company, or refreshes it to today, in one
// transaction: it checks the three accounts, removes the previous demo
// content (purge, as Remove) and writes the plan built for now. It writes
// nothing when an account is refused or db is not the connection's database.
func Apply(ctx context.Context, pool Beginner, db Database, accounts Accounts, now time.Time) (Applied, error) {
	out := Applied{Company: CompanyID()}
	tx, err := pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return out, err
	}
	defer tx.Rollback(ctx)
	if err := db.verify(ctx, tx); err != nil {
		return out, err
	}
	people, err := lookupAccounts(ctx, tx, accounts)
	if err != nil {
		return out, err
	}
	plan, err := BuildPlan(now, people)
	if err != nil {
		return out, fmt.Errorf("build the demo: %w", err)
	}
	if out.Removed, err = purge(ctx, tx, CompanyID(), plan.FictitiousUsers); err != nil {
		return out, err
	}
	batch := &pgx.Batch{}
	for _, s := range plan.Statements {
		batch.Queue(s.SQL, s.Args...)
	}
	results := tx.SendBatch(ctx, batch)
	for i := range plan.Statements {
		if _, err := results.Exec(); err != nil {
			results.Close()
			return out, fmt.Errorf("demo row %d (%s): %w", i, tableOf(plan.Statements[i].SQL), err)
		}
	}
	if err := results.Close(); err != nil {
		return out, err
	}
	out.Statements = len(plan.Statements)
	return out, tx.Commit(ctx)
}

// Remove deletes the demo company and everything tied to it in one
// transaction. The three accounts lose their demo membership and keep their
// users row; audit_events rows stay (append-only, no foreign keys). Running it
// again deletes nothing.
func Remove(ctx context.Context, pool Beginner, db Database) (Removed, error) {
	tx, err := pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	if err := db.verify(ctx, tx); err != nil {
		return nil, err
	}
	removed, err := purge(ctx, tx, CompanyID(), FictitiousUsers())
	if err != nil {
		return nil, err
	}
	return removed, tx.Commit(ctx)
}

func tableOf(sql string) string {
	target := strings.Fields(sql)[2]
	table, _, _ := strings.Cut(target, "(")
	return table
}

// lookupAccounts resolves the three emails to existing, distinct employer
// accounts that belong to no company or to the demo company already.
func lookupAccounts(ctx context.Context, tx pgx.Tx, accounts Accounts) (People, error) {
	var people People
	fictitious := map[uuid.UUID]bool{}
	for _, r := range recruiters {
		fictitious[ID("user", r.key)] = true
	}
	seen := map[uuid.UUID]string{}
	for _, a := range []struct {
		role, email string
		id          *uuid.UUID
	}{{"owner", accounts.OwnerEmail, &people.Owner}, {"stakeholder", accounts.StakeholderEmail, &people.Stakeholder}, {"recruiter", accounts.RecruiterEmail, &people.Recruiter}} {
		email := strings.TrimSpace(a.email)
		if email == "" {
			return people, fmt.Errorf("%w: the %s email is required", ErrAccount, a.role)
		}
		var id uuid.UUID
		var kind, name string
		var company *uuid.UUID
		err := tx.QueryRow(ctx, `SELECT u.id, u.user_type, u.full_name, m.company_id FROM users u LEFT JOIN company_members m ON m.user_id=u.id
 WHERE lower(u.email)=lower($1) AND u.deleted_at IS NULL`, email).Scan(&id, &kind, &name, &company)
		switch {
		case errors.Is(err, pgx.ErrNoRows):
			return people, fmt.Errorf("%w: no account with the %s email %s (register it in the app first)", ErrAccount, a.role, email)
		case err != nil:
			return people, fmt.Errorf("look up the %s account: %w", a.role, err)
		case kind != "recruiter":
			return people, fmt.Errorf("%w: the %s account %s is a %s account, not an employer account", ErrAccount, a.role, email, kind)
		case company != nil && *company != CompanyID():
			return people, fmt.Errorf("%w: the %s account %s already belongs to another company", ErrAccount, a.role, email)
		case fictitious[id] || strings.HasSuffix(strings.ToLower(email), "@example.invalid"):
			return people, fmt.Errorf("%w: %s is a demo account", ErrAccount, email)
		}
		if other, dup := seen[id]; dup {
			return people, fmt.Errorf("%w: the %s and %s emails are the same account", ErrAccount, other, a.role)
		}
		seen[id] = a.role
		*a.id = id
		if a.role == "owner" {
			people.OwnerName = name
		}
	}
	return people, nil
}

// purge deletes every row tied to the company (the demo's, or a benchmark
// company's), children first, plus the fictitious users. Every statement is
// scoped by that company id or the fixed fictitious user ids, so no other
// company is ever touched. audit_events has no foreign keys and refuses
// deletes (append-only): its rows stay.
func purge(ctx context.Context, tx pgx.Tx, company uuid.UUID, fictitious []uuid.UUID) (Removed, error) {
	const processes = `(SELECT id FROM vacancy_processes WHERE company_id=$1)`
	const participations = `(SELECT p.id FROM process_participations p WHERE p.process_id IN ` + processes + `)`
	steps := []struct {
		table, sql string
		users      bool
	}{
		{"participation_stage_history", `DELETE FROM participation_stage_history WHERE participation_id IN ` + participations, false},
		{"company_candidate_history", `DELETE FROM company_candidate_history WHERE company_id=$1 OR participation_id IN ` + participations, false},
		{"placement_credits", `DELETE FROM placement_credits WHERE company_id=$1 OR process_id IN (SELECT id FROM job_drafts WHERE company_id=$1)`, false},
		{"process_delivery_fulfillments", `DELETE FROM process_delivery_fulfillments WHERE process_id IN ` + processes, false},
		{"process_coverage_milestones", `DELETE FROM process_coverage_milestones WHERE process_id IN ` + processes, false},
		{"participation_idempotency", `DELETE FROM participation_idempotency WHERE process_id IN ` + processes, false},
		{"process_participations", `DELETE FROM process_participations WHERE process_id IN ` + processes, false},
		{"company_candidate_corrections", `DELETE FROM company_candidate_corrections WHERE company_id=$1`, false},
		{"company_candidate_cvs", `DELETE FROM company_candidate_cvs WHERE company_id=$1`, false},
		{"company_candidate_languages", `DELETE FROM company_candidate_languages WHERE company_candidate_id IN (SELECT id FROM company_candidates WHERE company_id=$1)`, false},
		{"company_candidates", `DELETE FROM company_candidates WHERE company_id=$1`, false},
		{"job_draft_idempotency", `DELETE FROM job_draft_idempotency WHERE company_id=$1`, false},
		// Cascades to processes, lifecycle events, projections, teams,
		// tramos, functions, reassignments, mode, commitment and closing
		// target changes, and the draft configurations.
		{"job_drafts", `DELETE FROM job_drafts WHERE company_id=$1`, false},
		{"job_draft_requesters", `DELETE FROM job_draft_requesters WHERE company_id=$1`, false},
		// Rows the seed never writes but the app may create for the company
		// once someone uses it: legacy jobs (POST /jobs, saved_jobs cascade)
		// and their applications; the careers site (GET /v2/me/company/site
		// lazily creates its draft row) with its slug history and media.
		{"applications", `DELETE FROM applications WHERE job_id IN (SELECT id FROM jobs WHERE company_id=$1)`, false},
		{"jobs", `DELETE FROM jobs WHERE company_id=$1`, false},
		{"company_site_slug_history", `DELETE FROM company_site_slug_history WHERE company_id=$1`, false},
		{"company_site_media", `DELETE FROM company_site_media WHERE company_id=$1`, false},
		{"company_sites", `DELETE FROM company_sites WHERE company_id=$1`, false},
		{"company_members", `DELETE FROM company_members WHERE company_id=$1`, false},
		{"companies", `DELETE FROM companies WHERE id=$1`, false},
		{"candidate_cv_library", `DELETE FROM candidate_cv_library WHERE candidate_id=ANY($1)`, true},
		{"candidate_cv_versions", `DELETE FROM candidate_cv_versions WHERE candidate_id=ANY($1)`, true},
		{"users", `DELETE FROM users WHERE id=ANY($1) AND NOT EXISTS (SELECT 1 FROM company_members m WHERE m.user_id=users.id)`, true},
	}
	var out Removed
	for _, s := range steps {
		arg := any(company)
		if s.users {
			arg = fictitious
		}
		tag, err := tx.Exec(ctx, s.sql, arg)
		if err != nil {
			return out, fmt.Errorf("remove demo %s: %w", s.table, err)
		}
		out = append(out, TableCount{Table: s.table, Rows: tag.RowsAffected()})
	}
	return out, nil
}
