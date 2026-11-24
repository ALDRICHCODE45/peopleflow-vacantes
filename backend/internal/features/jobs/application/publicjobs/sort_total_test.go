package publicjobs

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestParseQuerySort(t *testing.T) {
	for raw, want := range map[string]string{
		"":                             SortRecent,
		"sort=recent":                  SortRecent,
		"sort=salary_desc":             SortSalaryDesc,
		"sort=salary_asc":              SortSalaryAsc,
		"q=Go&sort=salary_asc&limit=5": SortSalaryAsc,
	} {
		q, err := ParseQuery(raw)
		if err != nil || q.Sort != want {
			t.Fatalf("%q: sort=%q err=%v", raw, q.Sort, err)
		}
	}
	// Not a filter: an unknown sort uses the listing's invalid_request shape.
	for _, raw := range []string{"sort=", "sort=price", "sort=SALARY_DESC", "sort=salary_desc&sort=salary_desc", "sort=recent%20", "sort=salary"} {
		if _, err := ParseQuery(raw); !errors.Is(err, ErrInvalidRequest) {
			t.Fatalf("%q accepted: %v", raw, err)
		}
	}
}

func TestSortCursorBinding(t *testing.T) {
	at := time.Date(2026, 11, 24, 10, 0, 0, 0, time.UTC)
	recent, err := ParseQuery("q=Go")
	if err != nil {
		t.Fatal(err)
	}
	explicit, err := ParseQuery("q=Go&sort=recent")
	if err != nil {
		t.Fatal(err)
	}
	// Recent binds exactly as before sort existed, so old cursors stay valid.
	if filterHash(recent) != filterHash(explicit) || filterHash(recent) != filterHash(Query{Q: "Go"}) {
		t.Fatal("recent changed the historical binding")
	}
	p := Position{PublishedAt: at, Source: "vacancy", ID: uuid.New()}
	token, err := encodeCursor(recent, p)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(decodeTokenJSON(t, token), "salary") {
		t.Fatal("recent cursor bytes changed")
	}
	for _, raw := range []string{"q=Go", "q=Go&sort=recent"} {
		if _, err := ParseQuery(raw + "&cursor=" + token); err != nil {
			t.Fatalf("%s rejected recent cursor: %v", raw, err)
		}
	}
	for _, other := range []string{"salary_desc", "salary_asc"} {
		if _, err := ParseQuery("q=Go&sort=" + other + "&cursor=" + token); !errors.Is(err, ErrInvalidRequest) {
			t.Fatalf("recent cursor accepted by %s", other)
		}
	}

	desc, _ := ParseQuery("q=Go&sort=salary_desc")
	salaryPos := Position{PublishedAt: at, Source: "vacancy", ID: uuid.New(), SalaryGroup: 17, Salary: "45000.00"}
	descToken, err := encodeCursor(desc, salaryPos)
	if err != nil {
		t.Fatal(err)
	}
	got, err := ParseQuery("q=Go&sort=salary_desc&cursor=" + descToken)
	if err != nil || got.After == nil || *got.After != salaryPos {
		t.Fatalf("salary cursor round trip: %+v %v", got.After, err)
	}
	for _, other := range []string{"q=Go", "q=Go&sort=recent", "q=Go&sort=salary_asc", "q=Rust&sort=salary_desc"} {
		if _, err := ParseQuery(other + "&cursor=" + descToken); !errors.Is(err, ErrInvalidRequest) {
			t.Fatalf("salary_desc cursor accepted by %s", other)
		}
	}

	// Positions carry the sort key only under salary sorts, in canonical form.
	asc, _ := ParseQuery("sort=salary_asc")
	for name, tc := range map[string]struct {
		q Query
		p Position
	}{
		"recent with salary":       {recent, Position{PublishedAt: at, Source: "vacancy", ID: p.ID, Salary: "1.00"}},
		"recent with group":        {recent, Position{PublishedAt: at, Source: "vacancy", ID: p.ID, SalaryGroup: 1}},
		"salary sort without key":  {asc, Position{PublishedAt: at, Source: "vacancy", ID: p.ID}},
		"non decimal salary":       {asc, Position{PublishedAt: at, Source: "vacancy", ID: p.ID, Salary: "1e9"}},
		"three decimals":           {asc, Position{PublishedAt: at, Source: "vacancy", ID: p.ID, Salary: "1.001"}},
		"negative group":           {asc, Position{PublishedAt: at, Source: "vacancy", ID: p.ID, Salary: "0", SalaryGroup: -1}},
		"group beyond hidden tier": {asc, Position{PublishedAt: at, Source: "vacancy", ID: p.ID, Salary: "0", SalaryGroup: SalaryGroupHidden + 1}},
	} {
		forged, err := encodeCursor(tc.q, tc.p)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := decodeCursor(tc.q, forged); !errors.Is(err, ErrInvalidRequest) {
			t.Fatalf("%s accepted", name)
		}
	}
	for _, salary := range []string{"0", "-38000.00", "38000", "999999999999.99"} {
		pos := Position{PublishedAt: at, Source: "legacy", ID: p.ID, Salary: salary, SalaryGroup: SalaryGroupHidden}
		token, _ := encodeCursor(asc, pos)
		if _, err := decodeCursor(asc, token); err != nil {
			t.Fatalf("%s rejected: %v", salary, err)
		}
	}
}

func decodeTokenJSON(t *testing.T, token string) string {
	t.Helper()
	raw, err := base64.RawURLEncoding.DecodeString(token)
	if err != nil {
		t.Fatal(err)
	}
	return string(raw)
}

type countingReaderStub struct {
	catalogReaderStub
	count      int
	countLimit int
}

// SearchTotal mimics the store: one read returns the page and the total
// bounded at countLimit.
func (s *countingReaderStub) SearchTotal(ctx context.Context, q Query, countLimit int) ([]Row, int, error) {
	s.countLimit = countLimit
	rows, err := s.Search(ctx, q)
	return rows, min(s.count, countLimit), err
}

func TestCatalogSortCursorAndTotal(t *testing.T) {
	at := time.Date(2026, 11, 24, 10, 0, 0, 0, time.UTC)
	rows := []Row{}
	for i := range 3 {
		rows = append(rows, Row{Detail: Detail{Item: Item{ID: uuid.UUID{15: byte(i + 1)}, Source: "vacancy", PublishedAt: at}}, SalaryGroup: 0, Salary: []string{"45000.00", "38000.00", "0"}[i]})
	}
	stub := &countingReaderStub{catalogReaderStub: catalogReaderStub{rows: rows}, count: 7}
	q, err := ParseQuery("q=Go&sort=salary_desc&limit=2")
	if err != nil {
		t.Fatal(err)
	}
	page, err := NewCatalog(stub).List(context.Background(), q)
	if err != nil {
		t.Fatal(err)
	}
	if stub.query.Sort != SortSalaryDesc || page.NextCursor == nil || page.Total != (Total{Count: 7}) {
		t.Fatalf("page=%+v query=%+v", page, stub.query)
	}
	// The total is bounded at cap+1 and capped at the cap.
	if stub.countLimit != DefaultTotalCap+1 {
		t.Fatalf("count limit=%d", stub.countLimit)
	}
	next, err := ParseQuery("q=Go&sort=salary_desc&limit=2&cursor=" + url.QueryEscape(*page.NextCursor))
	if err != nil || next.After == nil || next.After.Salary != "38000.00" || next.After.ID != rows[1].Detail.ID {
		t.Fatalf("anchor=%+v %v", next.After, err)
	}

	stub.count = DefaultTotalCap + 1
	page, err = NewCatalog(stub).List(context.Background(), q)
	if err != nil || page.Total != (Total{Count: DefaultTotalCap, Capped: true}) {
		t.Fatalf("capped total=%+v %v", page.Total, err)
	}
	stub.count = DefaultTotalCap
	page, err = NewCatalog(stub).List(context.Background(), q)
	if err != nil || page.Total != (Total{Count: DefaultTotalCap}) {
		t.Fatalf("exact cap total=%+v %v", page.Total, err)
	}

	small := NewCatalog(stub)
	small.totalCap = 2
	stub.count = 3
	if page, err := small.List(context.Background(), q); err != nil || page.Total != (Total{Count: 2, Capped: true}) || stub.countLimit != 3 {
		t.Fatalf("injected cap total=%+v limit=%d %v", page.Total, stub.countLimit, err)
	}
}

// Readers without SearchTotal are counted through Search, bounded at cap+1
// and without cursor or sort; the page query is still the last one issued.
func TestCatalogTotalFallbackAndEnvelope(t *testing.T) {
	at := time.Date(2026, 11, 24, 10, 0, 0, 0, time.UTC)
	stub := &catalogReaderStub{rows: []Row{{Detail: Detail{Item: Item{ID: uuid.New(), Source: "vacancy", PublishedAt: at}}}}}
	page, err := NewCatalog(stub).List(context.Background(), Query{Limit: 5})
	if err != nil || page.Total != (Total{Count: 1}) || stub.query.Limit != 6 {
		t.Fatalf("total=%+v limit=%d %v", page.Total, stub.query.Limit, err)
	}
	raw, err := json.Marshal(page)
	if err != nil {
		t.Fatal(err)
	}
	var envelope map[string]json.RawMessage
	if err := json.Unmarshal(raw, &envelope); err != nil {
		t.Fatal(err)
	}
	if len(envelope) != 3 || string(envelope["total"]) != `{"count":1,"capped":false}` {
		t.Fatalf("envelope=%s", raw)
	}
	stub.rows = []Row{}
	page, err = NewCatalog(stub).List(context.Background(), Query{Limit: 5})
	if raw, _ := json.Marshal(page); err != nil || !strings.Contains(string(raw), `"total":{"count":0,"capped":false}`) {
		t.Fatalf("empty=%s %v", raw, err)
	}
}
