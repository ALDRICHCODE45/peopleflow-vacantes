//go:build integration

// Isolated-PostgreSQL coverage for the requester catalog adapter (contract §7).
// Same DSN guard as store_integration_test.go: only the loopback `draft_test`
// database named by DRAFT_TEST_DATABASE_URL.
package draftstore

import (
	"context"
	"errors"
	"sync"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/audit_events/domain/entities"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/drafts"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/requesters"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/domain/valueobjects"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// newRequesterPrincipal is newPrincipal plus cleanup of requester audit rows,
// which the draft cleanup does not cover.
func newRequesterPrincipal(t *testing.T, pool *pgxpool.Pool) principal {
	t.Helper()
	p := newPrincipal(t, pool)
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(),
			`DELETE FROM audit_events WHERE entity_id IN (SELECT id FROM job_draft_requesters WHERE company_id = $1)`, p.companyID)
	})
	return p
}

func mustName(t *testing.T, raw string) valueobjects.RequesterName {
	t.Helper()
	name, err := valueobjects.NewRequesterName(raw)
	if err != nil {
		t.Fatalf("NewRequesterName(%q): %v", raw, err)
	}
	return name
}

func createRequester(t *testing.T, store *Store, p principal, kind, raw string) requesters.Entry {
	t.Helper()
	entry, err := store.CreateRequester(context.Background(), p.companyID, p.ownerID, kind, mustName(t, raw))
	if err != nil {
		t.Fatalf("CreateRequester(%s, %q): %v", kind, raw, err)
	}
	return entry
}

func requireAlreadyExists(t *testing.T, err error, want requesters.Entry) {
	t.Helper()
	var dup *requesters.AlreadyExistsError
	if !errors.As(err, &dup) {
		t.Fatalf("error = %v, want *AlreadyExistsError", err)
	}
	if dup.Existing != want {
		t.Errorf("existing = %+v, want %+v", dup.Existing, want)
	}
}

func requesterCount(t *testing.T, pool *pgxpool.Pool, companyID uuid.UUID) int {
	t.Helper()
	return countRows(t, pool, `SELECT count(*) FROM job_draft_requesters WHERE company_id = $1`, companyID)
}

func TestCreateRequester_PersistsNormalizedEntryAndAudit(t *testing.T) {
	pool := requireDraftPool(t)
	store := newStore(t, pool)
	p := newRequesterPrincipal(t, pool)

	entry := createRequester(t, store, p, requesters.KindInternalArea, "  Departamento   de TI ")
	if entry.Kind != requesters.KindInternalArea || entry.Name != "Departamento de TI" || entry.ID == uuid.Nil {
		t.Fatalf("entry = %+v", entry)
	}

	var companyID uuid.UUID
	var kind, name, key string
	var version int
	if err := pool.QueryRow(context.Background(),
		`SELECT company_id, kind, name, name_key, normalization_version FROM job_draft_requesters WHERE id = $1`, entry.ID,
	).Scan(&companyID, &kind, &name, &key, &version); err != nil {
		t.Fatalf("read row: %v", err)
	}
	if companyID != p.companyID || kind != entry.Kind || name != "Departamento de TI" || key != "departamento de ti" || version != 1 {
		t.Errorf("row = %v %q %q %q %d", companyID, kind, name, key, version)
	}
	if got := auditCount(t, pool, entry.ID, entities.EventJobDraftRequesterCreated); got != 1 {
		t.Errorf("audit rows = %d, want 1", got)
	}
}

func TestCreateRequester_RecruiterMayCreate(t *testing.T) {
	pool := requireDraftPool(t)
	store := newStore(t, pool)
	p := newRequesterPrincipal(t, pool)
	recruiter := addMember(t, pool, p.companyID, "recruiter")

	entry, err := store.CreateRequester(context.Background(), p.companyID, recruiter, requesters.KindClient, mustName(t, "Cyber Power"))
	if err != nil || entry.Name != "Cyber Power" {
		t.Fatalf("recruiter create = %+v, %v", entry, err)
	}
}

// Contract vectors: 'Área' == 'A\u0301REA'; 'Area' is distinct; NBSP is a space;
// Straße == STRASSE. A duplicate writes no row and no audit event.
func TestCreateRequester_DuplicateVectors(t *testing.T) {
	pool := requireDraftPool(t)
	store := newStore(t, pool)
	p := newRequesterPrincipal(t, pool)
	ctx := context.Background()

	area := createRequester(t, store, p, requesters.KindInternalArea, "Área")
	for _, dup := range []string{"A\u0301REA", "área", "  ÁREA  "} {
		_, err := store.CreateRequester(ctx, p.companyID, p.ownerID, requesters.KindInternalArea, mustName(t, dup))
		requireAlreadyExists(t, err, area)
	}
	createRequester(t, store, p, requesters.KindInternalArea, "Area")

	nbsp := createRequester(t, store, p, requesters.KindInternalArea, "Recursos Humanos")
	_, err := store.CreateRequester(ctx, p.companyID, p.ownerID, requesters.KindInternalArea, mustName(t, "Recursos\u00a0Humanos"))
	requireAlreadyExists(t, err, nbsp)

	strasse := createRequester(t, store, p, requesters.KindClient, "Straße")
	_, err = store.CreateRequester(ctx, p.companyID, p.ownerID, requesters.KindClient, mustName(t, "STRASSE"))
	requireAlreadyExists(t, err, strasse)

	if got := requesterCount(t, pool, p.companyID); got != 4 {
		t.Errorf("rows = %d, want 4", got)
	}
	if got := countRows(t, pool,
		`SELECT count(*) FROM audit_events WHERE event_type = $1 AND entity_id IN (SELECT id FROM job_draft_requesters WHERE company_id = $2)`,
		entities.EventJobDraftRequesterCreated, p.companyID); got != 4 {
		t.Errorf("audit rows = %d, want 4", got)
	}
}

func TestCreateRequester_SeparatesKindsAndCompanies(t *testing.T) {
	pool := requireDraftPool(t)
	store := newStore(t, pool)
	a := newRequesterPrincipal(t, pool)
	b := newRequesterPrincipal(t, pool)

	area := createRequester(t, store, a, requesters.KindInternalArea, "Ventas")
	client := createRequester(t, store, a, requesters.KindClient, "Ventas")
	other := createRequester(t, store, b, requesters.KindInternalArea, "Ventas")
	if area.ID == client.ID || area.ID == other.ID {
		t.Fatalf("entries must be distinct: %+v %+v %+v", area, client, other)
	}

	// A duplicate in company B reports B's entry, never A's.
	_, err := store.CreateRequester(context.Background(), b.companyID, b.ownerID, requesters.KindInternalArea, mustName(t, "VENTAS"))
	requireAlreadyExists(t, err, other)
}

func TestCreateRequester_ConcurrentSameNameCreatesOne(t *testing.T) {
	pool := requireDraftPool(t)
	store := newStore(t, pool)
	p := newRequesterPrincipal(t, pool)

	const workers = 8
	name := mustName(t, "Acme")
	var wg sync.WaitGroup
	results := make(chan error, workers)
	for range workers {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := store.CreateRequester(context.Background(), p.companyID, p.ownerID, requesters.KindClient, name)
			results <- err
		}()
	}
	wg.Wait()
	close(results)

	created, duplicates := 0, 0
	for err := range results {
		var dup *requesters.AlreadyExistsError
		switch {
		case err == nil:
			created++
		case errors.As(err, &dup):
			duplicates++
		default:
			t.Errorf("unexpected error: %v", err)
		}
	}
	if created != 1 || duplicates != workers-1 {
		t.Errorf("created=%d duplicates=%d, want 1/%d", created, duplicates, workers-1)
	}
	if got := requesterCount(t, pool, p.companyID); got != 1 {
		t.Errorf("rows = %d, want 1", got)
	}
}

func TestRequesters_AuthorizationGates(t *testing.T) {
	pool := requireDraftPool(t)
	store := newStore(t, pool)
	p := newRequesterPrincipal(t, pool)
	ctx := context.Background()
	outsider := insertUser(t, pool)
	registerUserCleanup(t, pool, outsider)
	inactive := insertCompany(t, pool, "pending_verification")
	inactiveOwner := insertUser(t, pool)
	insertMembership(t, pool, inactive, inactiveOwner, "owner")
	registerCompanyCleanup(t, pool, inactive, inactiveOwner)

	list := requesters.ListRequest{Kind: requesters.KindClient, Limit: requesters.DefaultLimit}
	cases := []struct {
		name      string
		companyID uuid.UUID
		actorID   uuid.UUID
		want      error
	}{
		{"unknown user", p.companyID, uuid.Must(uuid.NewV7()), drafts.ErrUnauthenticated},
		{"non-member", p.companyID, outsider, drafts.ErrForbidden},
		{"missing company", uuid.Must(uuid.NewV7()), p.ownerID, drafts.ErrCompanyInactive},
		{"inactive company", inactive, inactiveOwner, drafts.ErrCompanyNotActive},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := store.CreateRequester(ctx, tc.companyID, tc.actorID, requesters.KindClient, mustName(t, "Acme")); !errors.Is(err, tc.want) {
				t.Errorf("create error = %v, want %v", err, tc.want)
			}
			if _, err := store.ListRequesters(ctx, tc.companyID, tc.actorID, list); !errors.Is(err, tc.want) {
				t.Errorf("list error = %v, want %v", err, tc.want)
			}
		})
	}
	if got := requesterCount(t, pool, p.companyID) + requesterCount(t, pool, inactive); got != 0 {
		t.Errorf("rejected creates wrote %d rows", got)
	}
}

func listAll(t *testing.T, store *Store, p principal, kind, q string, limit int) ([]requesters.Entry, int) {
	t.Helper()
	query, err := requesters.NormalizeQuery(q)
	if err != nil {
		t.Fatalf("NormalizeQuery(%q): %v", q, err)
	}
	scope := requesters.Scope{CompanyID: p.companyID, Kind: kind, QNormalized: query.Normalized}
	var all []requesters.Entry
	pages := 0
	var after *requesters.Cursor
	for {
		page, err := store.ListRequesters(context.Background(), p.companyID, p.ownerID,
			requesters.ListRequest{Kind: kind, Query: query, Limit: limit, After: after})
		if err != nil {
			t.Fatalf("ListRequesters: %v", err)
		}
		pages++
		if page.Items == nil {
			t.Fatal("Items must be non-nil")
		}
		all = append(all, page.Items...)
		if page.NextCursor == "" {
			return all, pages
		}
		cursor, err := requesters.DecodeCursor(page.NextCursor, scope)
		if err != nil {
			t.Fatalf("server cursor rejected: %v", err)
		}
		after = &cursor
		if pages > 20 {
			t.Fatal("pagination did not terminate")
		}
	}
}

func names(entries []requesters.Entry) []string {
	out := make([]string, len(entries))
	for i, e := range entries {
		out[i] = e.Name
	}
	return out
}

func TestListRequesters_KeysetPaginationAndScope(t *testing.T) {
	pool := requireDraftPool(t)
	store := newStore(t, pool)
	p := newRequesterPrincipal(t, pool)
	other := newRequesterPrincipal(t, pool)

	for _, n := range []string{"Zeta", "alfa", "Beta", "Área de TI", "Area comercial"} {
		createRequester(t, store, p, requesters.KindInternalArea, n)
	}
	createRequester(t, store, p, requesters.KindClient, "Alfa Cliente")
	createRequester(t, store, other, requesters.KindInternalArea, "Alfa Ajena")

	// Byte order of the casefold key (COLLATE "C"): "alfa" < "area comercial" <
	// "beta" < "zeta" < "área de ti".
	want := []string{"alfa", "Area comercial", "Beta", "Zeta", "Área de TI"}
	for _, limit := range []int{1, 2, 50} {
		got, pages := listAll(t, store, p, requesters.KindInternalArea, "", limit)
		if len(got) != len(want) {
			t.Fatalf("limit %d: %v, want %v", limit, names(got), want)
		}
		for i := range want {
			if got[i].Name != want[i] || got[i].Kind != requesters.KindInternalArea {
				t.Fatalf("limit %d: %v, want %v", limit, names(got), want)
			}
		}
		if wantPages := (len(want) + limit - 1) / limit; pages != wantPages && pages != wantPages+1 {
			t.Errorf("limit %d: pages = %d", limit, pages)
		}
	}

	empty, _ := listAll(t, store, p, requesters.KindClient, "zzz", 20)
	if len(empty) != 0 {
		t.Errorf("no-match query returned %v", names(empty))
	}
}

func TestListRequesters_PrefixQueryUsesKeyAndEscapesLiterally(t *testing.T) {
	pool := requireDraftPool(t)
	store := newStore(t, pool)
	p := newRequesterPrincipal(t, pool)
	for _, n := range []string{"Área de TI", "Área legal", "Area comercial", "50% Retail", "500 Retail", "a_b", "axb"} {
		createRequester(t, store, p, requesters.KindClient, n)
	}

	cases := map[string][]string{
		"ÁREA":   {"Área de TI", "Área legal"},
		"área d": {"Área de TI"},
		"area":   {"Area comercial"},
		"50%":    {"50% Retail"},
		"a_":     {"a_b"},
	}
	for q, want := range cases {
		got, _ := listAll(t, store, p, requesters.KindClient, q, 20)
		if len(got) != len(want) {
			t.Errorf("q=%q: %v, want %v", q, names(got), want)
			continue
		}
		for i := range want {
			if got[i].Name != want[i] {
				t.Errorf("q=%q: %v, want %v", q, names(got), want)
				break
			}
		}
	}
}
