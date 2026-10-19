package httpjson

import (
	"encoding/json"
	"net/http/httptest"
	"testing"
)

func TestColumnErrorCatalog(t *testing.T) {
	for _, value := range []string{"stage_occupied", "impact_confirmation_required", "recovery_stage_required"} {
		t.Run(value, func(t *testing.T) {
			d := Resolve(Code(value))
			if d.Code != Code(value) || d.Status != 409 {
				t.Fatal(d)
			}
		})
	}
}
func TestColumnOccupiedDetailsExactAndFailClosed(t *testing.T) {
	rec := httptest.NewRecorder()
	WriteColumnError(rec, Resolve(CodeStageOccupied), []StageDetail{{StageID: "a"}, {StageID: "b"}})
	var out map[string]json.RawMessage
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil || len(out) != 3 || string(out["details"]) != `[{"stage_id":"a"},{"stage_id":"b"}]` {
		t.Fatal(rec.Body.String(), err)
	}
	rec = httptest.NewRecorder()
	WriteColumnError(rec, Definition{Code: CodeStageOccupied, Status: 200}, []StageDetail{{StageID: "private"}})
	if rec.Code != 500 || json.Unmarshal(rec.Body.Bytes(), &out) != nil {
		t.Fatal(rec.Body.String())
	}
	var plain map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &plain)
	if len(plain) != 2 {
		t.Fatal(plain)
	}
}
