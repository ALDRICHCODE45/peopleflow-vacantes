package publication

import (
	"reflect"
	"testing"
)

func TestPublishedWriteMissingExemptsOnlyPastCommitment(t *testing.T) {
	input := []string{"title_missing", "requester_missing", "request_date_missing", "hiring_headcount_missing", "delivery_cutoff_missing", "delivery_target_missing", "commitment_date_missing", "commitment_date_past"}
	want := append([]string{}, input[:len(input)-1]...)
	if got := PublishedWriteMissing(input); !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v want %v", got, want)
	}
	if got := PublishedWriteMissing([]string{"commitment_date_past"}); got == nil || len(got) != 0 {
		t.Fatalf("past only=%v", got)
	}
	if !reflect.DeepEqual(input, append(want, "commitment_date_past")) {
		t.Fatal("mutated input")
	}
}
