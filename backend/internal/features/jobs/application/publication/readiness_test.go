package publication

import (
	"reflect"
	"testing"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/deliveryconfig"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/vacancygeo"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/vacancymanagement"
)

func ptr[T any](v T) *T { return &v }

func TestReadinessGeographyByWorkMode(t *testing.T) {
	for _, tc := range []struct {
		name, mode string
		location   *vacancygeo.Location
		scope      *vacancygeo.RemoteScope
		want       string
	}{
		{name: "onsite missing", mode: "onsite", want: "location_missing"},
		{name: "hybrid missing", mode: "hybrid", want: "location_missing"},
		{name: "MX state absent", mode: "onsite", location: &vacancygeo.Location{Country: "MX"}, want: "location_incomplete"},
		{name: "MX municipality absent", mode: "hybrid", location: &vacancygeo.Location{Country: "MX", State: "14"}, want: "location_incomplete"},
		{name: "MX complete", mode: "onsite", location: &vacancygeo.Location{Country: "MX", State: "14", Municipality: "14039"}},
		{name: "international country only", mode: "hybrid", location: &vacancygeo.Location{Country: "CO"}},
		{name: "remote no scope", mode: "remote", want: "remote_scope_missing"},
		{name: "remote optional location", mode: "remote", scope: &vacancygeo.RemoteScope{Kind: "anywhere"}},
		{name: "onsite ignores scope", mode: "onsite", location: &vacancygeo.Location{Country: "CO"}, scope: &vacancygeo.RemoteScope{Kind: "countries", Countries: []string{"MX"}}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			missing := Evaluate(Offer{WorkMode: tc.mode, Location: tc.location, RemoteScope: tc.scope}, vacancymanagement.Configuration{}, deliveryconfig.Configuration{}, time.Now(), time.UTC)
			var got string
			for _, v := range missing {
				if v == "location_missing" || v == "location_incomplete" || v == "remote_scope_missing" {
					got = v
				}
			}
			if got != tc.want {
				t.Fatalf("geography=%s missing=%v", got, missing)
			}
		})
	}
}

func TestReadinessTableOrderAndOptionalFields(t *testing.T) {
	zone, err := time.LoadLocation(vacancymanagement.TimeZone)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, 10, 17, 3, 0, 0, 0, time.UTC)
	all := []string{"title_missing", "description_missing", "work_mode_missing", "work_schedule_missing", "contract_type_missing", "professional_area_missing", "requester_missing", "request_date_missing", "hiring_headcount_missing", "delivery_cutoff_missing", "delivery_target_missing", "commitment_date_missing"}
	if got := Evaluate(Offer{}, vacancymanagement.Configuration{}, deliveryconfig.Configuration{}, now, zone); !reflect.DeepEqual(got, all) {
		t.Fatalf("got=%v want=%v", got, all)
	}
	offer := Offer{Title: "Go", DescriptionPlain: "Responsibilities", Location: &vacancygeo.Location{Country: "CO"}, WorkMode: "onsite", WorkSchedule: "full_time", ContractType: "indefinite", ProfessionalArea: "technology_systems", RequesterID: "id"}
	management := vacancymanagement.Configuration{RequestDate: ptr("2026-10-11"), HiringHeadcount: ptr(int64(2))}
	delivery := deliveryconfig.Configuration{CutoffStageID: ptr("stage"), TargetQuantity: ptr(int64(5)), CommitmentDate: ptr("2026-10-16")}
	if got := Evaluate(offer, management, delivery, now, zone); got == nil || len(got) != 0 {
		t.Fatalf("today/optional requirements benefits salary should pass: %v", got)
	}
	// Remove each requirement independently, preserving the exact stable code.
	for _, tc := range []struct {
		name   string
		remove func(*Offer, *vacancymanagement.Configuration, *deliveryconfig.Configuration)
	}{
		{all[0], func(o *Offer, _ *vacancymanagement.Configuration, _ *deliveryconfig.Configuration) { o.Title = "" }},
		{all[1], func(o *Offer, _ *vacancymanagement.Configuration, _ *deliveryconfig.Configuration) {
			o.DescriptionPlain = " \n\u00a0"
		}},
		{all[2], func(o *Offer, _ *vacancymanagement.Configuration, _ *deliveryconfig.Configuration) { o.WorkMode = "" }},
		{all[3], func(o *Offer, _ *vacancymanagement.Configuration, _ *deliveryconfig.Configuration) {
			o.WorkSchedule = ""
		}},
		{all[4], func(o *Offer, _ *vacancymanagement.Configuration, _ *deliveryconfig.Configuration) {
			o.ContractType = ""
		}},
		{all[5], func(o *Offer, _ *vacancymanagement.Configuration, _ *deliveryconfig.Configuration) {
			o.ProfessionalArea = ""
		}},
		{all[6], func(o *Offer, _ *vacancymanagement.Configuration, _ *deliveryconfig.Configuration) {
			o.RequesterID = ""
		}},
		{all[7], func(_ *Offer, m *vacancymanagement.Configuration, _ *deliveryconfig.Configuration) {
			m.RequestDate = nil
		}},
		{all[8], func(_ *Offer, m *vacancymanagement.Configuration, _ *deliveryconfig.Configuration) {
			m.HiringHeadcount = nil
		}},
		{all[9], func(_ *Offer, _ *vacancymanagement.Configuration, d *deliveryconfig.Configuration) {
			d.CutoffStageID = nil
		}},
		{all[10], func(_ *Offer, _ *vacancymanagement.Configuration, d *deliveryconfig.Configuration) {
			d.TargetQuantity = nil
		}},
		{all[11], func(_ *Offer, _ *vacancymanagement.Configuration, d *deliveryconfig.Configuration) {
			d.CommitmentDate = nil
		}},
		{"commitment_date_past", func(_ *Offer, _ *vacancymanagement.Configuration, d *deliveryconfig.Configuration) {
			d.CommitmentDate = ptr("2026-10-15")
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			o, m, d := offer, management, delivery
			tc.remove(&o, &m, &d)
			if got := Evaluate(o, m, d, now, zone); !reflect.DeepEqual(got, []string{tc.name}) {
				t.Fatalf("got=%v", got)
			}
		})
	}
	delivery.CommitmentDate = ptr("2026-10-15")
	want := append(append([]string{}, all[:11]...), "commitment_date_past")
	if got := Evaluate(Offer{}, vacancymanagement.Configuration{}, deliveryconfig.Configuration{CommitmentDate: delivery.CommitmentDate}, now, zone); !reflect.DeepEqual(got, want) {
		t.Fatalf("past table order=%v", got)
	}
	if got := Evaluate(offer, management, delivery, now.Add(-24*time.Hour), zone); len(got) != 0 {
		t.Fatal("local whole day must be inclusive", got)
	}
}
