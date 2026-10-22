//go:build integration

package main

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/db"
	auditpostgres "github.com/aldrichcode45/peopleflow-vacantes/internal/features/audit_events/infrastructure/postgres"
	companiesusecases "github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/application/usecases"
	companiesentities "github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/entities"
	companiesvo "github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/valueobjects"
	companieshttp "github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/infrastructure/http"
	companiespostgres "github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/infrastructure/postgres"
	geopostgres "github.com/aldrichcode45/peopleflow-vacantes/internal/features/geo/infrastructure/postgres"
	identityhttp "github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/infrastructure/http"
	identitypostgres "github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/infrastructure/postgres"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/shared/httpjson"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

func newMemberGuardHarness(t *testing.T) *draftFlowHarness {
	t.Helper()
	pool := requireDraftFlowPool(t) // Explicit loopback draft_test only; never reads .env.
	signer := newDraftFlowSigner(t)
	q := db.New(pool)
	users := identitypostgres.NewUserRepository(q)
	members := companiespostgres.NewCompanyMemberRepository(pool)
	companies := companiespostgres.NewCompanyRepository(pool, auditpostgres.NewAuditEventRepository())
	service := companiesusecases.NewCompanyMemberService(members, users, companies, geopostgres.NewReader(q))
	router := newRouter(routerDeps{
		requireAuth:      identityhttp.RequireAuth(signer.verifier),
		requireRecruiter: identityhttp.RequireCompanyRole(users, members, companies, companiesvo.RecruiterRole),
		requireOwner:     identityhttp.RequireCompanyRole(users, members, companies, companiesvo.OwnerRole),
		memberHandler:    companieshttp.NewMemberHandler(service), queries: q, pool: pool,
	})
	server := httptest.NewServer(router)
	t.Cleanup(server.Close)
	return &draftFlowHarness{pool: pool, server: server, client: server.Client(), signer: signer}
}

func memberGuardID(t *testing.T, pool *pgxpool.Pool, userID uuid.UUID) uuid.UUID {
	t.Helper()
	var id uuid.UUID
	if err := pool.QueryRow(context.Background(), `SELECT id FROM company_members WHERE user_id=$1`, userID).Scan(&id); err != nil {
		t.Fatal(err)
	}
	return id
}

func memberGuardSnapshot(t *testing.T, pool *pgxpool.Pool, companyID uuid.UUID) string {
	t.Helper()
	var snapshot string
	if err := pool.QueryRow(context.Background(), `SELECT COALESCE(json_agg(m ORDER BY id)::text, '[]') FROM company_members m WHERE company_id=$1`, companyID).Scan(&snapshot); err != nil {
		t.Fatal(err)
	}
	return snapshot
}

func TestCompanyMembersLastOwnerHTTP(t *testing.T) {
	h := newMemberGuardHarness(t)
	for _, tc := range []struct {
		name, method, role, targetRole, newRole string
		anotherOwner, foreign, missing          bool
		status                                  int
		code                                    httpjson.Code
	}{
		{name: "demote self only owner", method: http.MethodPatch, role: "owner", newRole: "recruiter", status: 409, code: httpjson.CodeLastOwner},
		{name: "delete self only owner", method: http.MethodDelete, role: "owner", status: 409, code: httpjson.CodeLastOwner},
		{name: "keep only owner", method: http.MethodPatch, role: "owner", newRole: "owner", status: 200},
		{name: "demote other with another owner", method: http.MethodPatch, targetRole: "owner", newRole: "recruiter", status: 200},
		{name: "delete other with another owner", method: http.MethodDelete, targetRole: "owner", status: 204},
		{name: "demote self with another owner", method: http.MethodPatch, role: "owner", anotherOwner: true, newRole: "recruiter", status: 200},
		{name: "delete self with another owner", method: http.MethodDelete, role: "owner", anotherOwner: true, status: 204},
		{name: "promote non-owner", method: http.MethodPatch, targetRole: "recruiter", newRole: "owner", status: 200},
		{name: "update non-owner", method: http.MethodPatch, targetRole: "recruiter", newRole: "recruiter", status: 200},
		{name: "delete non-owner", method: http.MethodDelete, targetRole: "recruiter", status: 204},
		{name: "foreign owner demotion", method: http.MethodPatch, foreign: true, newRole: "recruiter", status: 404, code: httpjson.CodeNotFound},
		{name: "foreign owner deletion", method: http.MethodDelete, foreign: true, status: 404, code: httpjson.CodeNotFound},
		{name: "unknown demotion", method: http.MethodPatch, missing: true, newRole: "recruiter", status: 404, code: httpjson.CodeNotFound},
		{name: "unknown deletion", method: http.MethodDelete, missing: true, status: 404, code: httpjson.CodeNotFound},
		// A distinct actor cannot be owner while the target is the ONLY owner.
		{name: "non-owner cannot demote only owner", method: http.MethodPatch, role: "recruiter", targetRole: "owner", newRole: "recruiter", status: 403, code: httpjson.CodeForbidden},
		{name: "non-owner cannot delete only owner", method: http.MethodDelete, role: "recruiter", targetRole: "owner", status: 403, code: httpjson.CodeForbidden},
	} {
		t.Run(tc.name, func(t *testing.T) {
			c := draftFlowNewCompany(t, h.pool, "active")
			callerRole := tc.role
			if callerRole == "" {
				callerRole = "owner"
			}
			userID, sub := c.addUser(t, callerRole)
			targetID := memberGuardID(t, h.pool, userID)
			targetCompany := c
			if tc.targetRole != "" {
				targetUser, _ := c.addUser(t, tc.targetRole)
				targetID = memberGuardID(t, h.pool, targetUser)
			}
			if tc.anotherOwner {
				c.addUser(t, "owner")
			}
			if tc.foreign {
				targetCompany = draftFlowNewCompany(t, h.pool, "active")
				targetUser, _ := targetCompany.addUser(t, "owner")
				targetID = memberGuardID(t, h.pool, targetUser)
			}
			if tc.missing {
				targetID = uuid.New()
			}
			before := memberGuardSnapshot(t, h.pool, c.companyID)
			foreignBefore := memberGuardSnapshot(t, h.pool, targetCompany.companyID)
			response := h.do(t, tc.method, "/me/company/members/"+targetID.String(), fmt.Sprintf(`{"role":%q}`, tc.newRole), h.signer.validToken(t, sub), map[string]string{"Content-Type": "application/json"})
			if tc.code != "" {
				draftFlowAssertCatalogError(t, response, tc.status, string(tc.code))
			} else if response.status != tc.status {
				t.Fatalf("status=%d body=%s", response.status, response.body)
			}
			if tc.status >= 400 {
				if memberGuardSnapshot(t, h.pool, c.companyID) != before || memberGuardSnapshot(t, h.pool, targetCompany.companyID) != foreignBefore {
					t.Fatal("rejected request changed membership or timestamps")
				}
				return
			}
			var count int
			if err := h.pool.QueryRow(context.Background(), `SELECT count(*) FROM company_members WHERE id=$1`, targetID).Scan(&count); err != nil {
				t.Fatal(err)
			}
			if tc.method == http.MethodDelete {
				if count != 0 {
					t.Fatal("target not deleted")
				}
				return
			}
			var role string
			if err := h.pool.QueryRow(context.Background(), `SELECT role FROM company_members WHERE id=$1`, targetID).Scan(&role); err != nil || role != tc.newRole {
				t.Fatalf("role=%s err=%v", role, err)
			}
		})
	}
}

// Both requests have already been authorized as owners. Exercise persistence
// directly so a late middleware recheck cannot turn the expected 409 into 403.
func TestCompanyMembersLastOwnerConcurrent(t *testing.T) {
	pool := requireDraftFlowPool(t)
	for _, mode := range []string{"demote", "remove", "mixed"} {
		t.Run(mode, func(t *testing.T) {
			c := draftFlowNewCompany(t, pool, "active")
			first, _ := c.addUser(t, "owner")
			second, _ := c.addUser(t, "owner")
			targets := []uuid.UUID{memberGuardID(t, pool, second), memberGuardID(t, pool, first)}
			ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
			defer cancel()
			cfg := pool.Config().Copy()
			cfg.MaxConns, cfg.MinConns = 2, 0
			marker := "last-owner-" + uuid.NewString()
			cfg.ConnConfig.RuntimeParams["application_name"] = marker
			workers, err := pgxpool.NewWithConfig(ctx, cfg)
			if err != nil {
				t.Fatal(err)
			}
			defer workers.Close()
			blocker, err := pool.Begin(ctx)
			if err != nil {
				t.Fatal(err)
			}
			defer func() { _ = blocker.Rollback(context.Background()) }()
			var locked uuid.UUID
			if err := blocker.QueryRow(ctx, `SELECT id FROM companies WHERE id=$1 FOR UPDATE`, c.companyID).Scan(&locked); err != nil {
				t.Fatal(err)
			}
			start := make(chan struct{})
			ready := make(chan struct{}, 2)
			results := make(chan error, 2)
			for i, target := range targets {
				go func(i int, target uuid.UUID) {
					ready <- struct{}{}
					<-start
					repo := companiespostgres.NewCompanyMemberRepository(workers)
					if mode == "remove" || (mode == "mixed" && i == 0) {
						results <- repo.Remove(ctx, target, c.companyID)
					} else {
						results <- repo.UpdateRole(ctx, target, c.companyID, companiesvo.RecruiterRole)
					}
				}(i, target)
			}
			<-ready
			<-ready
			close(start)
			// Hold the common lock until BOTH workers are observably waiting on it.
			// No scheduler sleeps: polling only observes PostgreSQL lock state.
			ticker := time.NewTicker(10 * time.Millisecond)
			defer ticker.Stop()
			for waiting := 0; waiting != 2; {
				if err := pool.QueryRow(ctx, `SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND application_name=$1 AND wait_event_type='Lock'`, marker).Scan(&waiting); err != nil {
					t.Fatal(err)
				}
				if waiting == 2 {
					break
				}
				select {
				case err := <-results:
					t.Fatalf("worker completed without serialization: %v", err)
				case <-ctx.Done():
					t.Fatal("workers did not contend on the company lock")
				case <-ticker.C:
				}
			}
			if err := blocker.Commit(ctx); err != nil {
				t.Fatal(err)
			}
			successes, conflicts := 0, 0
			for range 2 {
				select {
				case err := <-results:
					switch {
					case err == nil:
						successes++
					case errors.Is(err, companiesentities.ErrLastOwner):
						conflicts++
					default:
						t.Fatalf("unexpected mutation error: %v", err)
					}
				case <-ctx.Done():
					t.Fatal("concurrent mutations did not finish")
				}
			}
			var owners int
			if err := pool.QueryRow(ctx, `SELECT count(*) FROM company_members WHERE company_id=$1 AND role='owner'`, c.companyID).Scan(&owners); err != nil {
				t.Fatal(err)
			}
			if successes != 1 || conflicts != 1 || owners != 1 {
				t.Fatalf("successes=%d conflicts=%d owners=%d", successes, conflicts, owners)
			}
		})
	}
}
