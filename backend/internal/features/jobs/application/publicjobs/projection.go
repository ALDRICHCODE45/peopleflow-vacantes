// Package publicjobs owns the additive public catalog contract and its VAC-4 projection.
package publicjobs

import (
	"encoding/json"
	"fmt"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/draftinput"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/draftjson"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/draftrich"
)

type Compensation struct {
	Mode      string  `json:"mode"`
	Amount    *string `json:"amount"`
	Min       *string `json:"min"`
	Max       *string `json:"max"`
	Currency  string  `json:"currency"`
	PayPeriod string  `json:"pay_period"`
	Basis     string  `json:"basis"`
}
type Requirements struct {
	Required  *string `json:"required"`
	Preferred *string `json:"preferred"`
}
type Benefits struct {
	Predefined []string `json:"predefined"`
	Custom     []string `json:"custom"`
}

// Projection is an allowlist, never a copy of the private fields object.
// Identity, publication time and source version are supplied by the transaction.
type Projection struct {
	Title              string          `json:"title"`
	Description        json.RawMessage `json:"description"`
	DescriptionPlain   string          `json:"description_plain"`
	Location           *string         `json:"location"`
	WorkMode           *string         `json:"work_mode"`
	WorkSchedule       *string         `json:"work_schedule"`
	ContractType       *string         `json:"contract_type"`
	ProfessionalArea   *string         `json:"professional_area"`
	Seniority          *string         `json:"seniority"`
	Requirements       Requirements    `json:"requirements"`
	Benefits           Benefits        `json:"benefits"`
	Compensation       *Compensation   `json:"compensation"`
	Skills             []string        `json:"skills"`
	ScreeningQuestions int             `json:"screening_questions"`
}

// BuildProjection accepts only a validated complete persisted v2 document.
// It derives plain text through the shared rich grammar and omits hidden or
// incomplete compensation rather than inventing any missing monetary metadata.
func BuildProjection(stored []byte) (Projection, error) {
	if err := draftinput.ValidatePersistedDraftV2(stored); err != nil {
		return Projection{}, fmt.Errorf("validate public projection source: %w", err)
	}
	value, err := draftjson.Decode(stored)
	if err != nil {
		return Projection{}, err
	}
	fields := value.(map[string]any)["fields"].(map[string]any)
	public := map[string]any{}
	for _, key := range []string{"title", "description", "location", "work_mode", "work_schedule", "contract_type", "professional_area", "seniority", "compensation", "skills"} {
		public[key] = fields[key]
	}
	rawPublic, err := json.Marshal(public)
	if err != nil {
		return Projection{}, err
	}
	var out Projection
	if err := json.Unmarshal(rawPublic, &out); err != nil {
		return Projection{}, err
	}
	raw, err := json.Marshal(fields)
	if err != nil {
		return Projection{}, err
	}
	// The private representation stores requirements/benefits under different keys.
	var groups struct {
		Required  *string  `json:"required_requirements"`
		Preferred *string  `json:"preferred_requirements"`
		Custom    []string `json:"custom_benefits"`
	}
	if err := json.Unmarshal(raw, &groups); err != nil {
		return Projection{}, err
	}
	out.ScreeningQuestions = len(fields["screening_questions"].([]any))
	out.Requirements = Requirements{Required: groups.Required, Preferred: groups.Preferred}
	out.Benefits = Benefits{Predefined: []string{}, Custom: groups.Custom}
	for _, v := range fields["benefits"].([]any) {
		out.Benefits.Predefined = append(out.Benefits.Predefined, v.(string))
	}
	doc, err := draftrich.ValidateDocument(fields["description"])
	if err != nil {
		return Projection{}, err
	}
	if doc != nil {
		out.Description = doc.Canonical
		out.DescriptionPlain = doc.Plain
	}
	c := fields["compensation"].(map[string]any)
	visible := c["public_visible"].(bool)
	complete := c["mode"] != nil && c["currency"] != nil && c["pay_period"] != nil && c["basis"] != nil
	hasAmount := c["mode"] == "fixed" && c["amount"] != nil
	hasRange := c["mode"] == "range" && c["min"] != nil && c["max"] != nil
	if !visible || !complete || !(hasAmount || hasRange) {
		out.Compensation = nil
	}
	return out, nil
}
