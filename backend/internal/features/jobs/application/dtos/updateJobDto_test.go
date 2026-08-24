// Unit tests for the PATCH /jobs/{id} input DTO.
//
// UpdateJobDto is the JSON body accepted by PATCH /jobs/{id}. The
// handler decodes the request body directly into this struct; encoding/
// json silently drops any field the struct does not declare. The DTO's
// job is to:
//
//   - distinguish absent / null / value for the three nullable columns
//     (location, salary_min, salary_max) using valueobjects.Optional[T];
//   - keep `company_id`, `id`, `updated_at`, `created_at`, etc. absent
//     from the struct so the immutable fields the spec pins are
//     silently dropped on decode;
//   - hand the use case raw `*string` values so the use case owns
//     parsing via the closed-set VOs.
package dtos

import (
	"encoding/json"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/domain/valueobjects"
)

// TestUpdateJobDto_DropsImmutableFields covers the spec scenario
// "immutable fields in body are ignored": `id`, `company_id`,
// `created_at`, `published_at`, `search_vector`, `deleted_at`,
// `updated_at` are not in the struct, so encoding/json drops them.
// The test pins the absence (no panic, no error) and asserts the
// editable fields still decode.
func TestUpdateJobDto_DropsImmutableFields(t *testing.T) {
	body := []byte(`{
		"id": "018e0000-0000-7000-8000-000000000099",
		"company_id": "018e0000-0000-7000-8000-000000000098",
		"created_at": "2026-01-01T00:00:00Z",
		"published_at": "2026-01-02T00:00:00Z",
		"search_vector": "ignored",
		"deleted_at": null,
		"updated_at": "2026-01-03T00:00:00Z",
		"title": "Engineer"
	}`)
	var got UpdateJobDto
	if err := json.Unmarshal(body, &got); err != nil {
		t.Fatalf("Unmarshal: %v", err)
	}
	if got.Title == nil || *got.Title != "Engineer" {
		t.Errorf("Title: want \"Engineer\", got %v", got.Title)
	}
}

// TestUpdateJobDto_TitleAndDescriptionArePointers covers the "non-nullable
// field, required-if-present" case: title and description decode to
// *string; nil means "absent", non-nil means "set to value". The
// spec does not require null vs absent discrimination for these
// fields, so the *string shape is the simplest correct answer.
func TestUpdateJobDto_TitleAndDescriptionArePointers(t *testing.T) {
	var got UpdateJobDto
	if err := json.Unmarshal([]byte(`{"title":"New","description":"New body"}`), &got); err != nil {
		t.Fatalf("Unmarshal: %v", err)
	}
	if got.Title == nil || *got.Title != "New" {
		t.Errorf("Title: want \"New\", got %v", got.Title)
	}
	if got.Description == nil || *got.Description != "New body" {
		t.Errorf("Description: %v", got.Description)
	}
}

// TestUpdateJobDto_TitleAbsentStaysNil covers the absent case: the
// struct's pointer field stays nil when the key is missing.
func TestUpdateJobDto_TitleAbsentStaysNil(t *testing.T) {
	var got UpdateJobDto
	if err := json.Unmarshal([]byte(`{}`), &got); err != nil {
		t.Fatalf("Unmarshal: %v", err)
	}
	if got.Title != nil {
		t.Errorf("Title: want nil, got %v", *got.Title)
	}
}

// TestUpdateJobDto_ClosedSetFieldsArePointers covers the four
// closed-set fields: work_mode, employment_type, seniority,
// salary_currency. They use *string; nil = absent, non-nil = set to
// the raw string the use case parses via valueobjects.Parse*.
func TestUpdateJobDto_ClosedSetFieldsArePointers(t *testing.T) {
	var got UpdateJobDto
	body := []byte(`{"work_mode":"remote","employment_type":"full_time","seniority":"senior","salary_currency":"MXN"}`)
	if err := json.Unmarshal(body, &got); err != nil {
		t.Fatalf("Unmarshal: %v", err)
	}
	if got.WorkMode == nil || *got.WorkMode != "remote" {
		t.Errorf("WorkMode: want \"remote\", got %v", got.WorkMode)
	}
	if got.EmploymentType == nil || *got.EmploymentType != "full_time" {
		t.Errorf("EmploymentType: want \"full_time\", got %v", got.EmploymentType)
	}
	if got.Seniority == nil || *got.Seniority != "senior" {
		t.Errorf("Seniority: want \"senior\", got %v", got.Seniority)
	}
	if got.SalaryCurrency == nil || *got.SalaryCurrency != "MXN" {
		t.Errorf("SalaryCurrency: want \"MXN\", got %v", got.SalaryCurrency)
	}
}

// TestUpdateJobDto_LocationTriState covers the three nullable
// columns' tri-state decode through valueobjects.Optional[T].
func TestUpdateJobDto_LocationTriState(t *testing.T) {
	tests := []struct {
		name    string
		body    string
		wantSet bool
		wantVal bool
		wantStr string
	}{
		{name: "absent", body: `{}`, wantSet: false},
		{name: "null clears", body: `{"location":null}`, wantSet: true, wantVal: false},
		{name: "value sets", body: `{"location":"CDMX"}`, wantSet: true, wantVal: true, wantStr: "CDMX"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var got UpdateJobDto
			if err := json.Unmarshal([]byte(tt.body), &got); err != nil {
				t.Fatalf("Unmarshal: %v", err)
			}
			if got.Location.Set != tt.wantSet {
				t.Errorf("Location.Set: want %v, got %v", tt.wantSet, got.Location.Set)
			}
			if got.Location.Valid != tt.wantVal {
				t.Errorf("Location.Valid: want %v, got %v", tt.wantVal, got.Location.Valid)
			}
			if tt.wantStr != "" && got.Location.Value != tt.wantStr {
				t.Errorf("Location.Value: want %q, got %q", tt.wantStr, got.Location.Value)
			}
		})
	}
}

// TestUpdateJobDto_SalaryMinMaxTriState covers the int pair tri-state.
func TestUpdateJobDto_SalaryMinMaxTriState(t *testing.T) {
	tests := []struct {
		name   string
		body   string
		minSet bool
		minVal bool
		minInt int
		maxSet bool
		maxVal bool
	}{
		{
			name:   "both absent",
			body:   `{}`,
			minSet: false, minVal: false,
			maxSet: false, maxVal: false,
		},
		{
			name:   "min null + max value",
			body:   `{"salary_min":null,"salary_max":80000}`,
			minSet: true, minVal: false,
			maxSet: true, maxVal: true, minInt: 0,
		},
		{
			name:   "both values",
			body:   `{"salary_min":40000,"salary_max":60000}`,
			minSet: true, minVal: true, minInt: 40000,
			maxSet: true, maxVal: true,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var got UpdateJobDto
			if err := json.Unmarshal([]byte(tt.body), &got); err != nil {
				t.Fatalf("Unmarshal: %v", err)
			}
			if got.SalaryMin.Set != tt.minSet {
				t.Errorf("SalaryMin.Set: want %v, got %v", tt.minSet, got.SalaryMin.Set)
			}
			if got.SalaryMin.Valid != tt.minVal {
				t.Errorf("SalaryMin.Valid: want %v, got %v", tt.minVal, got.SalaryMin.Valid)
			}
			if tt.minSet && tt.minVal && got.SalaryMin.Value != tt.minInt {
				t.Errorf("SalaryMin.Value: want %d, got %d", tt.minInt, got.SalaryMin.Value)
			}
			if got.SalaryMax.Set != tt.maxSet {
				t.Errorf("SalaryMax.Set: want %v, got %v", tt.maxSet, got.SalaryMax.Set)
			}
			if got.SalaryMax.Valid != tt.maxVal {
				t.Errorf("SalaryMax.Valid: want %v, got %v", tt.maxVal, got.SalaryMax.Valid)
			}
		})
	}
}

// TestUpdateJobDto_StatusIsPointer covers the optional status field.
func TestUpdateJobDto_StatusIsPointer(t *testing.T) {
	t.Run("present", func(t *testing.T) {
		var got UpdateJobDto
		if err := json.Unmarshal([]byte(`{"status":"published"}`), &got); err != nil {
			t.Fatalf("Unmarshal: %v", err)
		}
		if got.Status == nil || *got.Status != "published" {
			t.Errorf("Status: want \"published\", got %v", got.Status)
		}
	})
	t.Run("absent", func(t *testing.T) {
		var got UpdateJobDto
		if err := json.Unmarshal([]byte(`{}`), &got); err != nil {
			t.Fatalf("Unmarshal: %v", err)
		}
		if got.Status != nil {
			t.Errorf("Status (absent): want nil, got %v", *got.Status)
		}
	})
}

// TestUpdateJobDto_WrongSalaryMinTypeErrors covers the wrong-type
// error path: a string in an int field is not valid JSON and must
// surface a decode error so the handler returns 400.
func TestUpdateJobDto_WrongSalaryMinTypeErrors(t *testing.T) {
	var got UpdateJobDto
	if err := json.Unmarshal([]byte(`{"salary_min":"abc"}`), &got); err == nil {
		t.Fatal("Unmarshal: want error on wrong type, got nil")
	}
}

// TestUpdateJobDto_AllFieldsTogether exercises the full body shape
// the spec describes: every editable field set, every immutable field
// dropped, every nullable field's tri-state honored.
func TestUpdateJobDto_AllFieldsTogether(t *testing.T) {
	body := []byte(`{
		"id":"018e0000-0000-7000-8000-000000000099",
		"company_id":"018e0000-0000-7000-8000-000000000098",
		"created_at":"2026-01-01T00:00:00Z",
		"updated_at":"2026-01-02T00:00:00Z",
		"published_at":"2026-01-03T00:00:00Z",
		"search_vector":"x",
		"deleted_at":null,
		"title":"Senior Engineer",
		"description":"Lead the team",
		"work_mode":"hybrid",
		"employment_type":"contract",
		"seniority":"lead",
		"location":"Remote LATAM",
		"salary_min":90000,
		"salary_max":150000,
		"salary_currency":"USD",
		"status":"published"
	}`)
	var got UpdateJobDto
	if err := json.Unmarshal(body, &got); err != nil {
		t.Fatalf("Unmarshal: %v", err)
	}

	// Editable strings
	if got.Title == nil || *got.Title != "Senior Engineer" {
		t.Errorf("Title: %v", got.Title)
	}
	if got.Description == nil || *got.Description != "Lead the team" {
		t.Errorf("Description: %v", got.Description)
	}
	if got.WorkMode == nil || *got.WorkMode != "hybrid" {
		t.Errorf("WorkMode: %v", got.WorkMode)
	}
	if got.EmploymentType == nil || *got.EmploymentType != "contract" {
		t.Errorf("EmploymentType: %v", got.EmploymentType)
	}
	if got.Seniority == nil || *got.Seniority != "lead" {
		t.Errorf("Seniority: %v", got.Seniority)
	}
	if got.SalaryCurrency == nil || *got.SalaryCurrency != "USD" {
		t.Errorf("SalaryCurrency: %v", got.SalaryCurrency)
	}
	if got.Status == nil || *got.Status != "published" {
		t.Errorf("Status: %v", got.Status)
	}

	// Tri-state trio
	if !got.Location.Set || !got.Location.Valid || got.Location.Value != "Remote LATAM" {
		t.Errorf("Location: %+v", got.Location)
	}
	if !got.SalaryMin.Set || !got.SalaryMin.Valid || got.SalaryMin.Value != 90000 {
		t.Errorf("SalaryMin: %+v", got.SalaryMin)
	}
	if !got.SalaryMax.Set || !got.SalaryMax.Valid || got.SalaryMax.Value != 150000 {
		t.Errorf("SalaryMax: %+v", got.SalaryMax)
	}

	// type sanity: confirm the compiler accepts the optional type.
	var _ valueobjects.Optional[string] = got.Location
	var _ valueobjects.Optional[int] = got.SalaryMin
}
