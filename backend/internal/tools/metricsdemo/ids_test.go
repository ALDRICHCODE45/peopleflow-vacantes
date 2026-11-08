package metricsdemo

import (
	"testing"

	"github.com/google/uuid"
)

func TestIDsAreDeterministicVersion5(t *testing.T) {
	if CompanyID() != uuid.NewSHA1(Namespace, []byte("company")) {
		t.Fatalf("company id %s is not uuid v5 over the namespace", CompanyID())
	}
	// Pinned: changing the namespace or a label would orphan rows seeded by
	// an earlier version, which remove could then no longer find.
	if got := CompanyID().String(); got != "d9c29115-8540-5434-a4d2-3c577dcaabed" {
		t.Fatalf("company id moved: %s", got)
	}
	if got := ID("user", "mariana"); got != ID("user", "mariana") || got.Version() != 5 {
		t.Fatalf("user id %s", got)
	}
	seen := map[uuid.UUID]string{}
	for _, label := range [][]string{{"company"}, {"user", "mariana"}, {"user", "jorge"}, {"draft", "v01"}, {"draft", "v01", "x"}, {"draftv01"}} {
		id := ID(label...)
		if prev, ok := seen[id]; ok {
			t.Fatalf("%v collides with %s", label, prev)
		}
		seen[id] = label[0]
	}
	if ID("a", "b") == ID("a/b") {
		t.Fatal("labels with a separator collide with joined labels")
	}
}
