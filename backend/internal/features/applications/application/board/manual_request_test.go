package board

import (
	"errors"
	"testing"
)

func TestManualRequestShapeAndStage(t *testing.T) {
	const stage = "10000000-0000-0000-0000-000000000001"
	cases := []struct {
		name, body, code string
		shape            bool
	}{
		{"missing stage", `{"existing":null,"confirmed_distinct":false,"candidate":null}`, "", true},
		{"missing existing", `{"stage_id":null,"confirmed_distinct":false,"candidate":null}`, "", true},
		{"missing confirmation", `{"stage_id":null,"existing":null,"candidate":null}`, "", true},
		{"missing candidate", `{"stage_id":null,"existing":null,"confirmed_distinct":false}`, "", true},
		{"unknown key", `{"stage_id":null,"existing":null,"confirmed_distinct":false,"candidate":null,"extra":1}`, "", true},
		{"duplicate key", `{"stage_id":null,"stage_id":null,"existing":null,"confirmed_distinct":false,"candidate":null}`, "", true},
		{"trailing value", `{"stage_id":null,"existing":null,"confirmed_distinct":false,"candidate":null} {}`, "", true},
		{"array", `[]`, "", true},
		{"null root", `null`, "", true},
		{"null stage", `{"stage_id":null,"existing":null,"confirmed_distinct":false,"candidate":null}`, "required", false},
		{"empty stage", `{"stage_id":"","existing":null,"confirmed_distinct":false,"candidate":null}`, "invalid", false},
		{"malformed stage", `{"stage_id":"no","existing":null,"confirmed_distinct":false,"candidate":null}`, "invalid", false},
		{"numeric stage", `{"stage_id":1,"existing":null,"confirmed_distinct":false,"candidate":null}`, "invalid", false},
		{"boolean stage", `{"stage_id":false,"existing":null,"confirmed_distinct":false,"candidate":null}`, "invalid", false},
		{"object stage", `{"stage_id":{},"existing":null,"confirmed_distinct":false,"candidate":null}`, "invalid", false},
		{"explicit stage", `{"stage_id":"` + stage + `","existing":null,"confirmed_distinct":false,"candidate":null}`, "", false},
	}
	for _, tt := range cases {
		t.Run(tt.name, func(t *testing.T) {
			request, err := ParseManualRequest([]byte(tt.body))
			if tt.shape {
				if !errors.Is(err, ErrInvalidRequest) {
					t.Fatalf("shape error = %v", err)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			_, field := request.StageID()
			if tt.code == "" {
				if field != nil {
					t.Fatalf("unexpected field: %+v", field)
				}
				return
			}
			if field == nil || field.Field != "stage_id" || field.Code != tt.code {
				t.Fatalf("field = %+v, want stage_id %s", field, tt.code)
			}
		})
	}
}

func TestManualStageEligibility(t *testing.T) {
	const active = "10000000-0000-0000-0000-000000000001"
	const placement = "10000000-0000-0000-0000-000000000002"
	const exit = "10000000-0000-0000-0000-000000000003"
	pipeline := Pipeline{Stages: []Stage{{ID: active, Kind: "custom"}, {ID: placement, Kind: "placement"}}, Exit: Stage{ID: exit}}
	for _, tt := range []struct{ name, id, code string }{{"active", active, ""}, {"placement", placement, "not_allowed"}, {"exit", exit, "not_allowed"}, {"unknown", "10000000-0000-0000-0000-000000000004", "invalid"}} {
		t.Run(tt.name, func(t *testing.T) {
			field := ValidateManualStage(tt.id, pipeline)
			if tt.code == "" {
				if field != nil {
					t.Fatal(field)
				}
				return
			}
			if field == nil || field.Field != "stage_id" || field.Code != tt.code {
				t.Fatalf("field = %+v", field)
			}
		})
	}
}
