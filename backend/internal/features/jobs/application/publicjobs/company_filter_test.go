package publicjobs

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestCompanyFilterParsingAndCursorScope(t *testing.T) {
	const id = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
	for _, raw := range []string{"company_id=", "company_id=nope", "company_id=" + id + "&company_id=" + id, "company_id=%ZZ", "company_id=%FF", "company_id=" + id + ";bad", "company_id=" + strings.ReplaceAll(id, "-", "")} {
		if _, err := ParseQuery(raw); !errors.Is(err, ErrInvalidFilter) {
			t.Fatalf("%s: %v", raw, err)
		}
	}
	q, err := ParseQuery("company_id=" + strings.ToUpper(id))
	if err != nil || q.CompanyID != id {
		t.Fatalf("%+v %v", q, err)
	}
	token, err := encodeCursor(q, Position{ID: uuid.MustParse(id), Source: "vacancy", PublishedAt: time.Now().UTC()})
	if err != nil {
		t.Fatal(err)
	}
	for _, raw := range []string{"", "company_id=ffffffff-bbbb-cccc-dddd-eeeeeeeeeeee&"} {
		if _, err := ParseQuery(raw + "cursor=" + token); !errors.Is(err, ErrInvalidRequest) {
			t.Fatal("cursor escaped company scope", err)
		}
	}
	if _, err := ParseQuery("company_id=" + id + "&cursor=" + token); err != nil {
		t.Fatal(err)
	}
}

// Same mixed-source fixture as TestCatalogCursorUsesLastVisibleAcrossSourcesAndBindsFilters,
// with stable IDs and an independently encoded pre-company-filter cursor. This
// pins result order and cursor bytes when the new filter is absent.
func TestCatalogWithoutCompanyFilterPreservesExistingFixture(t *testing.T) {
	at := time.Date(2026, 10, 16, 18, 0, 0, 123456000, time.UTC)
	rows := []Row{}
	for i, source := range []string{"vacancy", "legacy", "legacy"} {
		id := uuid.UUID{15: byte(i + 1)}
		rows = append(rows, Row{Detail: Detail{Item: Item{ID: id, Source: source, PublishedAt: at}}, Rank: 0.12345679104328156})
	}
	q, err := ParseQuery("q=Go&limit=2")
	if err != nil {
		t.Fatal(err)
	}
	page, err := NewCatalog(&catalogReaderStub{rows: rows}).List(context.Background(), q)
	if err != nil {
		t.Fatal(err)
	}
	if len(page.Items) != 2 {
		t.Fatal(page)
	}
	for i := range page.Items {
		if !reflect.DeepEqual(page.Items[i], enrich(rows[i].Detail).Item) {
			t.Fatalf("changed item/order %d", i)
		}
	}
	// Historical scalar/geography binding before company_id existed.
	sum := sha256.Sum256([]byte(`["Go",[],[],[],"","","",""]`))
	raw, err := json.Marshal(cursorToken{Version: 2, Filters: hex.EncodeToString(sum[:]), Position: Position{Rank: rows[1].Rank, PublishedAt: at, Source: "legacy", ID: rows[1].Detail.ID}})
	if err != nil {
		t.Fatal(err)
	}
	want := base64.RawURLEncoding.EncodeToString(raw)
	if page.NextCursor == nil || *page.NextCursor != want {
		t.Fatalf("cursor changed: %+v want %s", page.NextCursor, want)
	}
	if _, err := ParseQuery("q=Go&limit=1&cursor=" + want); err != nil {
		t.Fatal("historical cursor rejected", err)
	}
}
