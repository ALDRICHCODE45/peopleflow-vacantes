package deliveryconfig

import (
	"errors"
	"testing"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/drafts"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/pipelineconfig"
	"github.com/google/uuid"
)

func TestConfirmationStrictOptionalBoolean(t *testing.T) {
	p := pipelineconfig.Defaults(uuid.New())
	cal := CalendarAt(time.Now(), time.UTC)
	base := `"cutoffStageId":null,"targetQuantity":null,"commitmentDate":null`
	for _, tc := range []struct {
		name, extra    string
		confirm, valid bool
	}{
		{"omitted", "", false, true}, {"true", `,"confirm_fulfillment":true`, true, true},
		{"false", `,"confirm_fulfillment":false`, false, true}, {"null", `,"confirm_fulfillment":null`, false, false},
		{"string", `,"confirm_fulfillment":"true"`, false, false}, {"unknown", `,"confirm":true`, false, false},
		{"duplicate", `,"confirm_fulfillment":true,"confirm_fulfillment":false`, false, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			body := []byte(`{` + base + tc.extra + `}`)
			c, err := Replace(Configuration{}, p, body, cal)
			if tc.valid {
				if err != nil || !c.Equal(Configuration{}) {
					t.Fatal(c, err)
				}
				got, err := Confirmation(body)
				if err != nil || got != tc.confirm {
					t.Fatal(got, err)
				}
			} else if !errors.Is(err, drafts.ErrInvalidRequest) {
				t.Fatalf("got %v", err)
			}
		})
	}
}
