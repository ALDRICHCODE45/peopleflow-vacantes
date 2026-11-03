package board

import "testing"

func TestCreditCan(t *testing.T) {
	for _, status := range []string{"active", "did_not_hold", "voided"} {
		for _, owner := range []bool{false, true} {
			t.Run(status+map[bool]string{true: " owner", false: " recruiter"}[owner], func(t *testing.T) {
				got := CreditCan(owner, &PlacementCredit{Status: status})
				want := CreditCapabilities{Void: owner && status != "voided", Restore: owner && status == "voided"}
				if got != want {
					t.Fatal(got, want)
				}
			})
		}
	}
	if got := CreditCan(true, nil); got != (CreditCapabilities{}) {
		t.Fatal(got)
	}
}
