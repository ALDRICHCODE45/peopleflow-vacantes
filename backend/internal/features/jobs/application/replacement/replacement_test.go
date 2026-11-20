package replacement

import (
	"errors"
	"reflect"
	"strings"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/deliveryconfig"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/drafts"
	"github.com/google/uuid"
)

// 2026-12-14 is a Monday, 2026-12-12 a Saturday.
var calendar = deliveryconfig.Calendar{MinDate: "2026-11-20", MaxDate: "2027-11-19"}

func credits(n int) (string, []uuid.UUID) {
	ids := make([]uuid.UUID, n)
	quoted := make([]string, n)
	for i := range ids {
		ids[i] = uuid.New()
		quoted[i] = `"` + ids[i].String() + `"`
	}
	return "[" + strings.Join(quoted, ",") + "]", ids
}

func TestDecodeValid(t *testing.T) {
	list, ids := credits(2)
	responsible := uuid.New()
	for name, tc := range map[string]struct {
		body string
		want Request
	}{
		"defaults to the number of credits": {`{"placement_credit_ids":` + list + `,"commitment_date":"2026-12-14"}`, Request{CreditIDs: ids, TargetQuantity: 2, CommitmentDate: "2026-12-14"}},
		"target above credits":              {`{"placement_credit_ids":` + list + `,"commitment_date":"2026-12-14","target_quantity":5}`, Request{CreditIDs: ids, TargetQuantity: 5, CommitmentDate: "2026-12-14"}},
		"null optionals":                    {`{"placement_credit_ids":` + list + `,"commitment_date":"2026-12-14","target_quantity":null,"responsible":null,"publish":null,"carried_candidates":null}`, Request{CreditIDs: ids, TargetQuantity: 2, CommitmentDate: "2026-12-14"}},
		"explicit defaults":                 {`{"placement_credit_ids":` + list + `,"commitment_date":"2026-12-14","publish":false,"carried_candidates":[]}`, Request{CreditIDs: ids, TargetQuantity: 2, CommitmentDate: "2026-12-14"}},
		"responsible":                       {`{"placement_credit_ids":` + list + `,"commitment_date":"2026-12-14","responsible":{"user_id":"` + responsible.String() + `"}}`, Request{CreditIDs: ids, TargetQuantity: 2, CommitmentDate: "2026-12-14", Responsible: &responsible}},
		"window edges":                      {`{"placement_credit_ids":` + list + `,"commitment_date":"2026-11-20"}`, Request{CreditIDs: ids, TargetQuantity: 2, CommitmentDate: "2026-11-20"}},
	} {
		got, err := Decode([]byte(tc.body), calendar)
		if err != nil || !reflect.DeepEqual(got, tc.want) {
			t.Errorf("%s: %+v, %v; want %+v", name, got, err, tc.want)
		}
	}
}

func TestDecodeShapeErrorsAreInvalidRequest(t *testing.T) {
	list, ids := credits(2)
	date := `"commitment_date":"2026-12-14"`
	many := make([]string, MaxCredits+1)
	for i := range many {
		many[i] = `"` + uuid.NewString() + `"`
	}
	for name, body := range map[string]string{
		"not json":                 `{`,
		"array":                    `[]`,
		"no credits":               `{` + date + `}`,
		"empty credits":            `{"placement_credit_ids":[],` + date + `}`,
		"too many credits":         `{"placement_credit_ids":[` + strings.Join(many, ",") + `],` + date + `}`,
		"credits not a list":       `{"placement_credit_ids":"x",` + date + `}`,
		"credit not a string":      `{"placement_credit_ids":[1],` + date + `}`,
		"credit not a uuid":        `{"placement_credit_ids":["x"],` + date + `}`,
		"credit not canonical":     `{"placement_credit_ids":["` + strings.ToUpper(ids[0].String()) + `"],` + date + `}`,
		"duplicate credit":         `{"placement_credit_ids":["` + ids[0].String() + `","` + ids[0].String() + `"],` + date + `}`,
		"no date":                  `{"placement_credit_ids":` + list + `}`,
		"date not a string":        `{"placement_credit_ids":` + list + `,"commitment_date":20261214}`,
		"date not a date":          `{"placement_credit_ids":` + list + `,"commitment_date":"14/12/2026"}`,
		"date not canonical":       `{"placement_credit_ids":` + list + `,"commitment_date":"2026-2-3"}`,
		"unknown key":              `{"placement_credit_ids":` + list + `,` + date + `,"x":1}`,
		"target string":            `{"placement_credit_ids":` + list + `,` + date + `,"target_quantity":"2"}`,
		"target fraction":          `{"placement_credit_ids":` + list + `,` + date + `,"target_quantity":2.5}`,
		"responsible not object":   `{"placement_credit_ids":` + list + `,` + date + `,"responsible":"x"}`,
		"responsible no user":      `{"placement_credit_ids":` + list + `,` + date + `,"responsible":{}}`,
		"responsible bad user":     `{"placement_credit_ids":` + list + `,` + date + `,"responsible":{"user_id":"x"}}`,
		"responsible extra key":    `{"placement_credit_ids":` + list + `,` + date + `,"responsible":{"user_id":"` + uuid.NewString() + `","x":1}}`,
		"publish not a bool":       `{"placement_credit_ids":` + list + `,` + date + `,"publish":"yes"}`,
		"publish true (R3c)":       `{"placement_credit_ids":` + list + `,` + date + `,"publish":true}`,
		"carried not a list":       `{"placement_credit_ids":` + list + `,` + date + `,"carried_candidates":{}}`,
		"carried candidates (R3b)": `{"placement_credit_ids":` + list + `,` + date + `,"carried_candidates":[{}]}`,
	} {
		if _, err := Decode([]byte(body), calendar); !errors.Is(err, drafts.ErrInvalidRequest) {
			t.Errorf("%s: %v, want invalid_request", name, err)
		}
	}
}

func TestDecodeValidationFields(t *testing.T) {
	list, _ := credits(2)
	body := func(extra, date string) []byte {
		return []byte(`{"placement_credit_ids":` + list + `,"commitment_date":"` + date + `"` + extra + `}`)
	}
	for name, tc := range map[string]struct {
		body []byte
		want []Field
	}{
		"below credits":        {body(`,"target_quantity":1`, "2026-12-14"), []Field{{"target_quantity", "below_credits_count"}}},
		"zero":                 {body(`,"target_quantity":0`, "2026-12-14"), []Field{{"target_quantity", "out_of_range"}}},
		"negative":             {body(`,"target_quantity":-3`, "2026-12-14"), []Field{{"target_quantity", "out_of_range"}}},
		"above max":            {body(`,"target_quantity":1000`, "2026-12-14"), []Field{{"target_quantity", "out_of_range"}}},
		"date in the past":     {body(``, "2026-11-19"), []Field{{"commitment_date", "out_of_range"}}},
		"date too far":         {body(``, "2027-11-20"), []Field{{"commitment_date", "out_of_range"}}},
		"both, in field order": {body(`,"target_quantity":1`, "2020-01-06"), []Field{{"target_quantity", "below_credits_count"}, {"commitment_date", "out_of_range"}}},
		// A range error outranks the business-day rule, as on the delivery PUT.
		"weekend out of range": {body(``, "2027-11-20"), []Field{{"commitment_date", "out_of_range"}}},
	} {
		_, err := Decode(tc.body, calendar)
		var invalid *Invalid
		if !errors.As(err, &invalid) || !reflect.DeepEqual(invalid.Fields, tc.want) {
			t.Errorf("%s: %v, want fields %v", name, err, tc.want)
		}
	}
	if _, err := Decode(body(``, "2026-12-12"), calendar); !errors.Is(err, deliveryconfig.ErrNonBusinessDate) {
		t.Errorf("saturday: %v, want non_business_date", err)
	}
}

func TestSortedCreditIDs(t *testing.T) {
	a, b := uuid.MustParse("00000000-0000-4000-8000-000000000002"), uuid.MustParse("00000000-0000-4000-8000-000000000001")
	r := Request{CreditIDs: []uuid.UUID{a, b}}
	if got := r.SortedCreditIDs(); !reflect.DeepEqual(got, []string{b.String(), a.String()}) || r.CreditIDs[0] != a {
		t.Fatalf("%v (input must stay in request order)", got)
	}
}
