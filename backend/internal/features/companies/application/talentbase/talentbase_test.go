package talentbase

import (
	"errors"
	"reflect"
	"testing"

	"github.com/google/uuid"
)

func TestParse(t *testing.T) {
	a, b := uuid.MustParse("11111111-1111-4111-8111-111111111111"), uuid.MustParse("22222222-2222-4222-8222-222222222222")
	for _, tc := range []struct {
		name   string
		body   string
		want   Replacement
		fields []Field
		rule   *RuleError
		bad    bool
	}{
		{name: "all recruiters", body: `{"mode":"all_recruiters","user_ids":[]}`, want: Replacement{Mode: ModeAllRecruiters, UserIDs: []uuid.UUID{}}},
		{name: "selected", body: `{"user_ids":["` + a.String() + `","` + b.String() + `"],"mode":"selected_users"}`, want: Replacement{Mode: ModeSelectedUsers, UserIDs: []uuid.UUID{a, b}}},
		{name: "empty selection is valid", body: `{"mode":"selected_users","user_ids":[]}`, want: Replacement{Mode: ModeSelectedUsers, UserIDs: []uuid.UUID{}}},
		{name: "mode missing", body: `{"user_ids":[]}`, fields: []Field{{"mode", FieldRequired}}},
		{name: "mode unknown", body: `{"mode":"x","user_ids":[]}`, fields: []Field{{"mode", FieldInvalid}}},
		{name: "mode null", body: `{"mode":null,"user_ids":[]}`, fields: []Field{{"mode", FieldInvalid}}},
		{name: "both bad", body: `{"mode":2}`, fields: []Field{{"mode", FieldInvalid}, {"user_ids", FieldRequired}}},
		{name: "user_ids null", body: `{"mode":"selected_users","user_ids":null}`, fields: []Field{{"user_ids", FieldInvalid}}},
		{name: "user_ids element not a uuid", body: `{"mode":"selected_users","user_ids":[1]}`, fields: []Field{{"user_ids", FieldInvalid}}},
		{name: "duplicate", body: `{"mode":"selected_users","user_ids":["` + a.String() + `","` + b.String() + `","` + a.String() + `"]}`, fields: []Field{{"user_ids[2]", FieldDuplicate}}},
		{name: "ids with all recruiters", body: `{"mode":"all_recruiters","user_ids":["` + a.String() + `"]}`, rule: &RuleError{Rule: RuleUsersNotApplicable, Field: "user_ids"}},
		{name: "unknown key", body: `{"mode":"all_recruiters","user_ids":[],"x":1}`, bad: true},
		{name: "repeated key", body: `{"mode":"all_recruiters","mode":"selected_users","user_ids":[]}`, bad: true},
		{name: "not an object", body: `[]`, bad: true},
		{name: "empty", body: ``, bad: true},
		{name: "trailing data", body: `{"mode":"all_recruiters","user_ids":[]} x`, bad: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got, err := Parse([]byte(tc.body))
			var invalid *InvalidFields
			var rule *RuleError
			switch {
			case tc.bad:
				if !errors.Is(err, ErrInvalidRequest) {
					t.Fatalf("err=%v", err)
				}
			case tc.fields != nil:
				if !errors.As(err, &invalid) || !reflect.DeepEqual(invalid.Fields, tc.fields) {
					t.Fatalf("err=%v", err)
				}
			case tc.rule != nil:
				if !errors.As(err, &rule) || *rule != *tc.rule {
					t.Fatalf("err=%v", err)
				}
			default:
				if err != nil || !reflect.DeepEqual(got, tc.want) {
					t.Fatalf("got=%+v err=%v", got, err)
				}
			}
		})
	}
}
