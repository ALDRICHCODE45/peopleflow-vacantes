package documents

import (
	"encoding/json"
	"reflect"
	"testing"
)

// L20: the owner of a row is {kind:"vacancy"} or {kind:"participation", participation_id, candidate, discarded}; nothing else.
func TestOwnerWireShape(t *testing.T) {
	vacancy, err := json.Marshal(VacancyOwner())
	if err != nil {
		t.Fatal(err)
	}
	if string(vacancy) != `{"kind":"vacancy"}` {
		t.Fatalf("vacancy owner: %s", vacancy)
	}
	for _, discarded := range []bool{false, true} {
		owner := ParticipationOwner(OverviewParticipation{
			ParticipationID: "p1", Candidate: NamedCandidate{Kind: "manual", ID: "c1", FullName: "Marta Ruiz"}, Discarded: discarded,
		})
		raw, err := json.Marshal(owner)
		if err != nil {
			t.Fatal(err)
		}
		var got map[string]any
		if err := json.Unmarshal(raw, &got); err != nil {
			t.Fatal(err)
		}
		want := map[string]any{
			"kind": "participation", "participation_id": "p1", "discarded": discarded,
			"candidate": map[string]any{"kind": "manual", "id": "c1", "full_name": "Marta Ruiz"},
		}
		if !reflect.DeepEqual(got, want) {
			t.Fatalf("participation owner (discarded=%v): %s", discarded, raw)
		}
	}
}

// An item row and a link row carry the shapes of GET P/documents plus `owner`, flat (no nesting of the base shape).
func TestOverviewRowsExtendTheListShapesWithOwner(t *testing.T) {
	item, err := json.Marshal(OverviewItem{Item: Item{ID: "d1", AllowedActions: []Action{ActionDownload}}, Owner: VacancyOwner()})
	if err != nil {
		t.Fatal(err)
	}
	var gotItem map[string]any
	if err := json.Unmarshal(item, &gotItem); err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"id", "participation_id", "name", "format", "allowed_actions", "owner", "updated_at", "created_by"} {
		if _, ok := gotItem[key]; !ok {
			t.Errorf("item has no %q: %s", key, item)
		}
	}
	link, err := json.Marshal(OverviewLink{Link: Link{ID: "l1", State: LinkRemoved, AllowedActions: []Action{ActionUnlink}}, Owner: VacancyOwner()})
	if err != nil {
		t.Fatal(err)
	}
	var gotLink map[string]any
	if err := json.Unmarshal(link, &gotLink); err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"id", "state", "linked_at", "linked_by", "allowed_actions", "source", "owner"} {
		if _, ok := gotLink[key]; !ok {
			t.Errorf("link has no %q: %s", key, link)
		}
	}
}

func oi(id, at string) OverviewItem {
	return OverviewItem{Item: Item{ID: id, UpdatedAt: at}}
}
func ol(id, at string) OverviewLink {
	return OverviewLink{Link: Link{ID: id, LinkedAt: at}}
}

func itemIDs(items []OverviewItem) []string {
	out := []string{}
	for _, i := range items {
		out = append(out, i.ID)
	}
	return out
}
func linkIDs(links []OverviewLink) []string {
	out := []string{}
	for _, l := range links {
		out = append(out, l.ID)
	}
	return out
}

// «cap 2000 rows across items+links, truncated keeping the newest»: the cap is shared, the newest rows of either kind survive,
// and each array stays newest first.
func TestCapNewestKeepsTheNewestAcrossItemsAndLinks(t *testing.T) {
	items := []OverviewItem{oi("i5", "2026-11-05T00:00:00.000000Z"), oi("i3", "2026-11-03T00:00:00.000000Z"), oi("i1", "2026-11-01T00:00:00.000000Z")}
	links := []OverviewLink{ol("l4", "2026-11-04T00:00:00.000000Z"), ol("l2", "2026-11-02T00:00:00.000000Z")}

	gotItems, gotLinks, truncated := CapNewest(items, links, 3)
	if !truncated || !reflect.DeepEqual(itemIDs(gotItems), []string{"i5", "i3"}) || !reflect.DeepEqual(linkIDs(gotLinks), []string{"l4"}) {
		t.Fatalf("cap 3: items %v links %v truncated %v", itemIDs(gotItems), linkIDs(gotLinks), truncated)
	}

	gotItems, gotLinks, truncated = CapNewest(items, links, 5)
	if truncated || len(gotItems) != 3 || len(gotLinks) != 2 {
		t.Fatalf("cap = total is not truncated: %d %d %v", len(gotItems), len(gotLinks), truncated)
	}

	gotItems, gotLinks, truncated = CapNewest(items, links, 1)
	if !truncated || !reflect.DeepEqual(itemIDs(gotItems), []string{"i5"}) || len(gotLinks) != 0 {
		t.Fatalf("cap 1: %v %v %v", itemIDs(gotItems), linkIDs(gotLinks), truncated)
	}
}

// Equal timestamps order by id descending, across kinds too; the arrays are never nil.
func TestCapNewestBreaksTiesByIDDescending(t *testing.T) {
	at := "2026-11-05T00:00:00.000000Z"
	items := []OverviewItem{oi("b", at), oi("a", at)}
	links := []OverviewLink{ol("c", at)}
	gotItems, gotLinks, truncated := CapNewest(items, links, 2)
	if !truncated || !reflect.DeepEqual(linkIDs(gotLinks), []string{"c"}) || !reflect.DeepEqual(itemIDs(gotItems), []string{"b"}) {
		t.Fatalf("ties: %v %v %v", itemIDs(gotItems), linkIDs(gotLinks), truncated)
	}
	emptyItems, emptyLinks, truncated := CapNewest(nil, nil, 2)
	if truncated || emptyItems == nil || emptyLinks == nil {
		t.Fatalf("empty input: %v %v %v", emptyItems, emptyLinks, truncated)
	}
}
