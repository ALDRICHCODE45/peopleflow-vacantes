package publicjobs

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/url"
	"slices"
	"testing"
	"time"

	"github.com/google/uuid"
)

const salaryUnits = "&salary_currency=MXN&salary_period=monthly&salary_basis=gross"

func TestParseQuerySalaryFilterAccepted(t *testing.T) {
	for _, tc := range []struct {
		raw      string
		min, max string
	}{
		{"salary_min=30000&salary_max=40000" + salaryUnits, "30000.00", "40000.00"},
		{"salary_min=30000" + salaryUnits, "30000.00", ""},
		{"salary_max=40000.5" + salaryUnits, "", "40000.50"},
		{"salary_min=0&salary_max=0" + salaryUnits, "0.00", "0.00"},
		{"salary_min=38000&salary_max=38000.00" + salaryUnits, "38000.00", "38000.00"},
		{"salary_min=999999999999.99" + salaryUnits, "999999999999.99", ""},
	} {
		t.Run(tc.raw, func(t *testing.T) {
			q, err := ParseQuery(tc.raw)
			if err != nil {
				t.Fatalf("valid salary filter rejected: %v", err)
			}
			if q.Salary == nil || q.Salary.Min != tc.min || q.Salary.Max != tc.max ||
				q.Salary.Currency != "MXN" || q.Salary.Period != "monthly" || q.Salary.Basis != "gross" {
				t.Fatalf("salary=%+v", q.Salary)
			}
		})
	}
	for _, units := range []string{
		"&salary_currency=USD&salary_period=hourly&salary_basis=net",
		"&salary_currency=MXN&salary_period=weekly&salary_basis=gross",
		"&salary_currency=MXN&salary_period=semimonthly&salary_basis=gross",
		"&salary_currency=MXN&salary_period=yearly&salary_basis=gross",
	} {
		if _, err := ParseQuery("salary_min=1" + units); err != nil {
			t.Fatalf("units %s rejected: %v", units, err)
		}
	}
	q, err := ParseQuery("q=Go")
	if err != nil || q.Salary != nil {
		t.Fatalf("no salary keys must leave the filter inactive: %+v %v", q.Salary, err)
	}
}

func TestParseQuerySalaryFilterRejected(t *testing.T) {
	for _, raw := range []string{
		// Amount grammar.
		"salary_min=" + salaryUnits, "salary_min=-1" + salaryUnits, "salary_min=01" + salaryUnits,
		"salary_min=1.234" + salaryUnits, "salary_min=1." + salaryUnits, "salary_min=.5" + salaryUnits,
		"salary_min=1e3" + salaryUnits, "salary_min=%201" + salaryUnits, "salary_min=1,000" + salaryUnits,
		"salary_min=1000000000000" + salaryUnits, "salary_max=abc" + salaryUnits,
		// Bounds order.
		"salary_min=40000&salary_max=30000" + salaryUnits, "salary_min=30000.01&salary_max=30000" + salaryUnits,
		// Repeated keys, even identical.
		"salary_min=1&salary_min=1" + salaryUnits, "salary_max=1&salary_max=2" + salaryUnits,
		"salary_min=1" + salaryUnits + "&salary_currency=MXN",
		// Enums are exact.
		"salary_min=1&salary_currency=mxn&salary_period=monthly&salary_basis=gross",
		"salary_min=1&salary_currency=EUR&salary_period=monthly&salary_basis=gross",
		"salary_min=1&salary_currency=MXN&salary_period=biweekly&salary_basis=gross",
		"salary_min=1&salary_currency=MXN&salary_period=monthly&salary_basis=Gross",
		"salary_min=1&salary_currency=&salary_period=monthly&salary_basis=gross",
		// Missing units with an amount.
		"salary_min=1", "salary_min=1&salary_currency=MXN&salary_period=monthly",
		"salary_max=1&salary_period=monthly&salary_basis=gross", "salary_max=1&salary_currency=MXN&salary_basis=gross",
		// Units without any amount.
		"salary_currency=MXN&salary_period=monthly&salary_basis=gross", "salary_currency=MXN", "salary_basis=net",
		// Encoding.
		"salary_min=%ZZ" + salaryUnits, "salary_min=%FF" + salaryUnits, "salary_min=1%00" + salaryUnits,
	} {
		t.Run(raw, func(t *testing.T) {
			if _, err := ParseQuery(raw); !errors.Is(err, ErrInvalidFilter) {
				t.Fatalf("want invalid_filter, got %v", err)
			}
		})
	}
}

func TestSalaryCursorBindingIsCanonicalAndBackwardCompatible(t *testing.T) {
	p := Position{ID: uuid.New(), Source: "vacancy", PublishedAt: time.Now().UTC()}
	q, err := ParseQuery("salary_min=30000&salary_max=40000" + salaryUnits)
	if err != nil {
		t.Fatal(err)
	}
	token, err := encodeCursor(q, p)
	if err != nil {
		t.Fatal(err)
	}
	equivalent := "salary_basis=gross&salary_period=monthly&salary_currency=MXN&salary_max=40000.0&salary_min=30000.00"
	if got, err := ParseQuery(equivalent + "&cursor=" + url.QueryEscape(token)); err != nil || got.After == nil || got.After.ID != p.ID {
		t.Fatalf("equivalent amounts must keep the cursor: %+v %v", got, err)
	}
	for _, changed := range []string{
		"salary_min=30000.01&salary_max=40000" + salaryUnits,
		"salary_min=30000" + salaryUnits,
		"salary_min=30000&salary_max=40000&salary_currency=USD&salary_period=monthly&salary_basis=gross",
		"salary_min=30000&salary_max=40000&salary_currency=MXN&salary_period=yearly&salary_basis=gross",
		"salary_min=30000&salary_max=40000&salary_currency=MXN&salary_period=monthly&salary_basis=net",
		"",
	} {
		if _, err := ParseQuery(changed + "&cursor=" + url.QueryEscape(token)); !errors.Is(err, ErrInvalidRequest) {
			t.Fatalf("changed salary filter accepted the cursor: %q %v", changed, err)
		}
	}
	// A query without salary keys hashes exactly as before this cut, so cursors
	// already handed out keep working after deployment.
	plain := Query{Q: "Go", States: []string{"09"}, WorkModes: []string{"remote"}}
	if got, want := filterHash(plain), legacyFilterHash(plain); got != want {
		t.Fatalf("hash without salary changed: %s != %s", got, want)
	}
}

// legacyFilterHash freezes the pre-salary filter binding.
func legacyFilterHash(q Query) string {
	canonical := func(values []string) []string {
		out := append([]string{}, values...)
		slices.Sort(out)
		return out
	}
	raw, _ := json.Marshal([]any{q.Q, canonical(q.States), canonical(q.Municipalities), canonical(q.WorkModes), q.ApplicantCountry, q.WorkSchedule, q.ContractType, q.ProfessionalArea})
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:])
}
