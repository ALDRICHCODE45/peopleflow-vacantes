package publicjobs

import (
	"context"
	"encoding/json"
	"errors"
	"net/url"
	"reflect"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestParseQueryStrictContract(t *testing.T) {
	for _, raw := range []string{"unknown=x", "limit=0", "limit=51", "limit=1&limit=2", "limit=", "limit=+1", "limit=1.0", "work_mode=Remote", "work_mode=", "work_schedule=contract", "contract_type=full_time", "professional_area=unknown", "q=a&q=b", "cursor=bad", "q=%ZZ", "location=%FF", "q=%00"} {
		t.Run(raw, func(t *testing.T) {
			if _, err := ParseQuery(raw); !errors.Is(err, ErrInvalidRequest) {
				t.Fatalf("accepted %q: %v", raw, err)
			}
		})
	}
	q, err := ParseQuery("q=Go&location=M%C3%A9xico&work_mode=remote&work_schedule=full_time&contract_type=indefinite&professional_area=technology_systems")
	if err != nil || q.Limit != 20 || q.Q != "Go" || q.Location != "México" {
		t.Fatalf("query=%+v error=%v", q, err)
	}
	for _, n := range []string{"1", "50"} {
		if _, err := ParseQuery("limit=" + n); err != nil {
			t.Fatal(err)
		}
	}
}

type catalogReaderStub struct {
	rows  []Row
	query Query
}

func (s *catalogReaderStub) Search(_ context.Context, q Query) ([]Row, error) {
	s.query = q
	return s.rows, nil
}
func (s *catalogReaderStub) Get(context.Context, uuid.UUID) (Detail, error) {
	return Detail{}, ErrNotFound
}

func TestCatalogCursorUsesLastVisibleAcrossSourcesAndBindsFilters(t *testing.T) {
	at := time.Date(2026, 10, 16, 18, 0, 0, 123456000, time.UTC)
	rows := []Row{}
	for _, source := range []string{"vacancy", "legacy", "legacy"} {
		rows = append(rows, Row{Detail: Detail{Item: Item{ID: uuid.New(), Source: source, PublishedAt: at}}, Rank: 0.12345679104328156})
	}
	stub := &catalogReaderStub{rows: rows}
	service := NewCatalog(stub)
	q, err := ParseQuery("q=Go&limit=2")
	if err != nil {
		t.Fatal(err)
	}
	result, err := service.List(context.Background(), q)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Items) != 2 || result.NextCursor == nil || stub.query.Limit != 3 {
		t.Fatalf("page=%+v", result)
	}
	q2, err := ParseQuery("q=Go&limit=1&cursor=" + url.QueryEscape(*result.NextCursor))
	if err != nil {
		t.Fatal(err)
	}
	if q2.After == nil || q2.After.ID != rows[1].Detail.ID || q2.After.Source != "legacy" || !q2.After.PublishedAt.Equal(at) || q2.After.Rank != rows[1].Rank {
		t.Fatalf("anchor=%+v", q2.After)
	}
	if _, err := ParseQuery("q=Other&cursor=" + url.QueryEscape(*result.NextCursor)); !errors.Is(err, ErrInvalidRequest) {
		t.Fatal("cursor reused with different search")
	}
	stub.rows = []Row{}
	empty, err := service.List(context.Background(), q)
	if err != nil || empty.Items == nil || empty.NextCursor != nil {
		t.Fatalf("empty=%+v %v", empty, err)
	}
}

func TestPublicShapesExactKeysAndNullability(t *testing.T) {
	item := Item{ID: uuid.New(), Source: "legacy", PublishedAt: time.Now().UTC()}
	raw, err := json.Marshal(item)
	if err != nil {
		t.Fatal(err)
	}
	var fields map[string]any
	if err := json.Unmarshal(raw, &fields); err != nil {
		t.Fatal(err)
	}
	expected := []string{"id", "source", "title", "company", "location", "work_mode", "work_schedule", "contract_type", "professional_area", "seniority", "legacy_employment_type", "compensation", "legacy_salary", "published_at"}
	if len(fields) != len(expected) {
		t.Fatalf("keys=%s", raw)
	}
	for _, k := range expected {
		if _, ok := fields[k]; !ok {
			t.Fatalf("missing %s", k)
		}
	}
	for _, k := range []string{"work_schedule", "contract_type", "professional_area", "compensation", "legacy_salary"} {
		if fields[k] != nil {
			t.Fatalf("%s=%v", k, fields[k])
		}
	}
	detail := Detail{Item: item, Benefits: Benefits{Predefined: []string{}, Custom: []string{}}}
	raw, err = json.Marshal(detail)
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(raw, &fields); err != nil {
		t.Fatal(err)
	}
	if len(fields) != len(expected)+4 || fields["description"] != nil || fields["description_plain"] != "" {
		t.Fatalf("detail=%s", raw)
	}
	if !reflect.DeepEqual(fields["requirements"], map[string]any{"required": nil, "preferred": nil}) || !reflect.DeepEqual(fields["benefits"], map[string]any{"predefined": []any{}, "custom": []any{}}) {
		t.Fatalf("extras=%s", raw)
	}
}
