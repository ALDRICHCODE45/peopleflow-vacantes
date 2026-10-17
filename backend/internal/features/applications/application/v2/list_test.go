package v2

import (
	"testing"
	"time"

	"github.com/google/uuid"
)

// §10.5: candidate paging rejects malformed and repeated parameters.
func TestStrictListQuery(t *testing.T) {
	for _, raw := range []string{"limit=0", "limit=51", "limit=01", "limit=1&limit=2", "cursor=", "cursor=bad", "other=1", "limit=%zz"} {
		t.Run(raw, func(t *testing.T) {
			if _, err := ParseQuery(raw); err == nil {
				t.Fatal("accepted invalid query")
			}
		})
	}
	p := Position{ID: uuid.New(), At: time.Now().UTC()}
	token, err := EncodeCursor(p)
	if err != nil {
		t.Fatal(err)
	}
	q, err := ParseQuery("limit=1&cursor=" + token)
	if err != nil || q.After == nil || q.After.ID != p.ID {
		t.Fatal(q, err)
	}
}
