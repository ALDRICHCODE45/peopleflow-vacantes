package preferences

import (
	"errors"
	"reflect"
	"strings"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/notifications/domain"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/shared/httpjson"
)

func TestParsePutAcceptsPartialLists(t *testing.T) {
	entries, err := ParsePut([]byte(`{"preferences":[{"type":"psychometric_pending","channel":"in_app","enabled":false},{"enabled":true,"channel":"email","type":"application_received"}]}`), domain.RecipientMember)
	if err != nil {
		t.Fatal(err)
	}
	want := []Entry{
		{domain.TypePsychometricPending, domain.ChannelInApp, false},
		{domain.TypeApplicationReceived, domain.ChannelEmail, true},
	}
	if !reflect.DeepEqual(entries, want) {
		t.Fatalf("entries = %+v", entries)
	}
	if _, err := ParsePut([]byte(`{"preferences":[{"type":"candidate_test_pending","channel":"email","enabled":false}]}`), domain.RecipientCandidate); err != nil {
		t.Fatal(err)
	}
}

func TestParsePutValidation(t *testing.T) {
	e := func(typ, ch, en string) string {
		return `{"type":"` + typ + `","channel":"` + ch + `","enabled":` + en + `}`
	}
	list := func(xs ...string) string { return `{"preferences":[` + strings.Join(xs, ",") + `]}` }
	many := make([]string, MaxEntries+1)
	for i := range many {
		many[i] = e("application_received", "email", "true")
	}
	for _, tc := range []struct {
		name, body string
		kind       domain.RecipientKind
		want       []httpjson.ValidationField
	}{
		{"absent", `{}`, domain.RecipientMember, []httpjson.ValidationField{{Field: "preferences", Code: "required"}}},
		{"empty", `{"preferences":[]}`, domain.RecipientMember, []httpjson.ValidationField{{Field: "preferences", Code: "empty"}}},
		{"too many", list(many...), domain.RecipientMember, []httpjson.ValidationField{{Field: "preferences", Code: "too_many"}}},
		{"other tree", list(e("candidate_status_changed", "email", "true")), domain.RecipientMember, []httpjson.ValidationField{{Field: "preferences[0].type", Code: "invalid"}}},
		{"empty entry", list(`{}`), domain.RecipientCandidate, []httpjson.ValidationField{
			{Field: "preferences[0].channel", Code: "required"}, {Field: "preferences[0].enabled", Code: "required"}, {Field: "preferences[0].type", Code: "required"}}},
		{"entries in index order", list(e("x", "email", "true"), e("application_received", "y", `"no"`), e("application_received", "email", "true"), e("application_received", "email", "false"),
			e("a", "b", "true"), e("a", "b", "true"), e("a", "b", "true"), e("a", "b", "true"), e("a", "b", "true"), e("a", "b", "true"), e("a", "email", "true")), domain.RecipientMember,
			[]httpjson.ValidationField{
				{Field: "preferences[0].type", Code: "invalid"},
				{Field: "preferences[1].channel", Code: "invalid"}, {Field: "preferences[1].enabled", Code: "invalid"},
				{Field: "preferences[3]", Code: "duplicate"},
				{Field: "preferences[4].channel", Code: "invalid"}, {Field: "preferences[4].type", Code: "invalid"},
				{Field: "preferences[5].channel", Code: "invalid"}, {Field: "preferences[5].type", Code: "invalid"},
				{Field: "preferences[6].channel", Code: "invalid"}, {Field: "preferences[6].type", Code: "invalid"},
				{Field: "preferences[7].channel", Code: "invalid"}, {Field: "preferences[7].type", Code: "invalid"},
				{Field: "preferences[8].channel", Code: "invalid"}, {Field: "preferences[8].type", Code: "invalid"},
				{Field: "preferences[9].channel", Code: "invalid"}, {Field: "preferences[9].type", Code: "invalid"},
				{Field: "preferences[10].type", Code: "invalid"},
			}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, err := ParsePut([]byte(tc.body), tc.kind)
			var invalid *InvalidBody
			if !errors.As(err, &invalid) {
				t.Fatalf("err = %v, want InvalidBody", err)
			}
			if !reflect.DeepEqual(invalid.Fields, tc.want) {
				t.Fatalf("fields = %+v\nwant     %+v", invalid.Fields, tc.want)
			}
		})
	}
}

func TestParsePutShapeErrors(t *testing.T) {
	for _, body := range []string{``, `null`, `[]`, `{"preferences":{}}`, `{"preferences":[1]}`, `{"preferences":[],"x":1}`,
		`{"preferences":[{"type":"application_received","channel":"email","enabled":true,"x":1}]}`, `{} {}`, `{"preferences":[`, `{"preferences":[null]}`, ` null `} {
		if _, err := ParsePut([]byte(body), domain.RecipientMember); !errors.Is(err, ErrInvalidRequest) {
			t.Errorf("%q: err = %v, want ErrInvalidRequest", body, err)
		}
	}
}

// Locked types (either channel, any enabled) are reported once each in table
// order, only when the whole list is otherwise valid.
func TestParsePutLocked(t *testing.T) {
	_, err := ParsePut([]byte(`{"preferences":[{"type":"vacancy_team_added","channel":"in_app","enabled":true},{"type":"application_received","channel":"email","enabled":true},`+
		`{"type":"delivery_overdue","channel":"email","enabled":false},{"type":"vacancy_team_added","channel":"email","enabled":false}]}`), domain.RecipientMember)
	var locked *LockedError
	if !errors.As(err, &locked) {
		t.Fatalf("err = %v, want LockedError", err)
	}
	if want := []string{"delivery_overdue", "vacancy_team_added"}; !reflect.DeepEqual(locked.Types, want) {
		t.Fatalf("types = %v, want %v", locked.Types, want)
	}
}
