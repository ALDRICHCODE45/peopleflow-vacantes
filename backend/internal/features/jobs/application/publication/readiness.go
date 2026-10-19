// Package publication owns the P1 publication gate without IO.
package publication

import (
	"strings"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/deliveryconfig"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/vacancygeo"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/vacancymanagement"
)

// Offer projects validated stored fields; DescriptionPlain is derived by draftrich.
// A requester kind without a catalog ID is an incomplete selection.
type Offer struct {
	Title            string
	DescriptionPlain string
	Location         *vacancygeo.Location
	RemoteScope      *vacancygeo.RemoteScope
	WorkMode         string
	WorkSchedule     string
	ContractType     string
	ProfessionalArea string
	RequesterID      string
}

// Evaluate always returns an array, in the contract table order (not sorted).
func Evaluate(offer Offer, management vacancymanagement.Configuration, delivery deliveryconfig.Configuration, now time.Time, zone *time.Location) []string {
	missing := make([]string, 0, 14)
	for _, field := range []struct{ code, value string }{
		{"title_missing", offer.Title},
		{"description_missing", offer.DescriptionPlain},

		{"work_mode_missing", offer.WorkMode},
		{"work_schedule_missing", offer.WorkSchedule},
		{"contract_type_missing", offer.ContractType},
		{"professional_area_missing", offer.ProfessionalArea},
		{"requester_missing", offer.RequesterID},
	} {
		if strings.TrimSpace(field.value) == "" {
			missing = append(missing, field.code)
		}
	}
	// Insert geography after description, retaining the established readiness order.
	var geography string
	if offer.WorkMode == "remote" {
		if offer.RemoteScope == nil {
			geography = "remote_scope_missing"
		}
	} else if offer.WorkMode == "onsite" || offer.WorkMode == "hybrid" {
		if offer.Location == nil || offer.Location.Country == "" {
			geography = "location_missing"
		} else if offer.Location.Country == "MX" && (offer.Location.State == "" || offer.Location.Municipality == "") {
			geography = "location_incomplete"
		}
	}
	if geography != "" {
		position := 0
		for position < len(missing) && (missing[position] == "title_missing" || missing[position] == "description_missing") {
			position++
		}
		missing = append(missing[:position], append([]string{geography}, missing[position:]...)...)
	}
	if management.RequestDate == nil {
		missing = append(missing, "request_date_missing")
	}
	if management.HiringHeadcount == nil {
		missing = append(missing, "hiring_headcount_missing")
	}
	if delivery.CutoffStageID == nil {
		missing = append(missing, "delivery_cutoff_missing")
	}
	if delivery.TargetQuantity == nil {
		missing = append(missing, "delivery_target_missing")
	}
	if delivery.CommitmentDate == nil {
		missing = append(missing, "commitment_date_missing")
	} else if *delivery.CommitmentDate < vacancymanagement.TodayAt(now, zone) {
		missing = append(missing, "commitment_date_past")
	}
	return missing
}
