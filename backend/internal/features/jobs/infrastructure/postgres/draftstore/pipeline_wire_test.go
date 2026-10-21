package draftstore

import (
	"encoding/json"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/lifecycle"
	pc "github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/pipelineconfig"
	"github.com/google/uuid"
)

func TestColumnPipelineGetPutExactWireKeys(t *testing.T) {
	id := uuid.New()
	c := pc.Defaults(id)
	c.Retired = []pc.RetiredStage{{Stage: pc.Stage{ID: uuid.NewString(), Kind: "custom", Name: "Kept label"}, Position: 2}}
	for _, put := range []bool{false, true} {
		var args []*pc.Impact
		if put {
			impact := pc.EmptyImpact()
			args = append(args, &impact)
		}
		result, err := renderPipeline(id, c, 4, true, args...)
		if err != nil {
			t.Fatal(err)
		}
		// The base configuration renderer is shared with PUT; GET alone embeds
		// the L1 lifecycle view after reading it in the surrounding transaction.
		if !put {
			result.Body, err = renderWithLifecycle(result.Body, lifecycle.View{Version: "0", AllowedActions: []string{"publish"}})
			if err != nil {
				t.Fatal(err)
			}
		}
		var obj map[string]any
		if err = json.Unmarshal(result.Body, &obj); err != nil {
			t.Fatal(err)
		}
		want := 7
		if len(obj) != want || obj["version"] != "4" || obj["structure_locked"] != true || obj["stages"] == nil || obj["exit"] == nil || obj["limits"] == nil || obj["retired"] == nil {
			t.Fatal(string(result.Body))
		}
		for _, s := range obj["stages"].([]any) {
			if len(s.(map[string]any)) != 3 {
				t.Fatal(s)
			}
		}
		retired := obj["retired"].([]any)[0].(map[string]any)
		if len(retired) != 3 || retired["name"] != "Kept label" || retired["id"] != c.Retired[0].ID {
			t.Fatal(retired)
		}
		if put {
			impact := obj["applied_impact"].(map[string]any)
			if len(impact) != 2 || len(impact["not_applicable"].([]any)) != 0 || len(impact["recovery_reassigned"].([]any)) != 0 {
				t.Fatal(impact)
			}
		} else {
			view := obj["lifecycle"].(map[string]any)
			if len(view) != 10 || view["publication"] != nil || view["process"] != nil || view["version"] != "0" {
				t.Fatal(view)
			}
			if _, present := obj["applied_impact"]; present {
				t.Fatal(obj)
			}
		}
	}
}
