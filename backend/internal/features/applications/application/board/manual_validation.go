package board

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/url"
	"strconv"
	"strings"
	"unicode/utf8"

	geoapp "github.com/aldrichcode45/peopleflow-vacantes/internal/features/geo/application"
	geo "github.com/aldrichcode45/peopleflow-vacantes/internal/features/geo/domain"
	identityvo "github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/valueobjects"
	sharedvo "github.com/aldrichcode45/peopleflow-vacantes/internal/shared/valueobjects"
	"github.com/google/uuid"
)

type ManualExisting struct {
	Kind string
	ID   uuid.UUID
}
type ManualLanguage struct{ Language, Level string }
type ManualCandidate struct {
	FullName, EducationLevel                                                            string
	Email, EmailNormalized, Phone                                                       *string
	Residence                                                                           *geo.Value
	ProfessionalTitle, CurrentCompany, FieldOfStudy, Summary, LinkedInURL, PortfolioURL *string
	ExperienceYears                                                                     *int
	Skills                                                                              []string
	Languages                                                                           []ManualLanguage
}
type ValidatedManualRequest struct {
	StageID           uuid.UUID
	Existing          *ManualExisting
	ConfirmedDistinct bool
	Candidate         *ManualCandidate
}

// manualObject verifies structural keys without interpreting field values.
func manualObject(raw []byte, allowed ...string) (map[string]json.RawMessage, error) {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	value, err := uniqueJSONValue(decoder)
	if err != nil {
		return nil, ErrInvalidRequest
	}
	if _, err = decoder.Token(); err != io.EOF {
		return nil, ErrInvalidRequest
	}
	object, ok := value.(map[string]any)
	if !ok {
		return nil, ErrInvalidRequest
	}
	keys := make(map[string]bool, len(allowed))
	for _, key := range allowed {
		keys[key] = true
	}
	for key := range object {
		if !keys[key] {
			return nil, ErrInvalidRequest
		}
	}
	var fields map[string]json.RawMessage
	if json.Unmarshal(raw, &fields) != nil {
		return nil, ErrInvalidRequest
	}
	return fields, nil
}
func manualNull(raw []byte) bool {
	return len(raw) == 0 || bytes.Equal(bytes.TrimSpace(raw), []byte("null"))
}

type manualFields []ManualFieldError

func (f *manualFields) add(path, code string) {
	*f = append(*f, ManualFieldError{Field: path, Code: code})
}
func (f *manualFields) text(raw []byte, path string, required bool, limit int) *string {
	if manualNull(raw) {
		if required {
			f.add(path, "required")
		}
		return nil
	}
	var value string
	if json.Unmarshal(raw, &value) != nil || !utf8.ValidString(value) {
		f.add(path, "invalid")
		return nil
	}
	value = strings.TrimSpace(value)
	if value == "" {
		if required {
			f.add(path, "required")
		}
		return &value
	}
	if limit > 0 && utf8.RuneCountInString(value) > limit {
		f.add(path, "too_long")
	}
	return &value
}

// Validate performs shape and field validation only: no process state, duplicate
// lookup, storage, or writes. Callers must authorize before invoking it. Geo
// catalog failures remain infrastructure errors, never public field errors.
func (r ManualRequest) Validate(ctx context.Context, lookup geoapp.Lookup, hasCV bool) (ValidatedManualRequest, []ManualFieldError, error) {
	var out ValidatedManualRequest
	var fields manualFields
	var candidate, existing map[string]json.RawMessage
	var err error
	if !manualNull(r.Candidate) {
		candidate, err = manualObject(r.Candidate, "full_name", "education_level", "email", "phone", "residence", "professional_title", "current_company", "field_of_study", "experience_years", "summary", "skills", "languages", "linkedin_url", "portfolio_url")
		if err != nil {
			return out, nil, err
		}
	}
	if !manualNull(r.Existing) {
		existing, err = manualObject(r.Existing, "kind", "id")
		if err != nil {
			return out, nil, err
		}
	}
	out.StageID, _ = r.StageID()
	if _, field := r.StageID(); field != nil {
		fields = append(fields, *field)
	}
	if manualNull(r.ConfirmedDistinct) || json.Unmarshal(r.ConfirmedDistinct, &out.ConfirmedDistinct) != nil {
		fields.add("confirmed_distinct", "invalid")
	}
	if existing != nil {
		out.Existing = &ManualExisting{}
		var id string
		if json.Unmarshal(existing["kind"], &out.Existing.Kind) != nil || (out.Existing.Kind != "manual" && out.Existing.Kind != "organic") {
			fields.add("existing", "invalid")
		} else if json.Unmarshal(existing["id"], &id) != nil {
			fields.add("existing", "invalid")
		} else if parsed, err := uuid.Parse(id); err != nil {
			fields.add("existing", "invalid")
		} else {
			out.Existing.ID = parsed
		}
		if candidate != nil {
			fields.add("candidate", "not_allowed")
		}
	} else if candidate == nil {
		fields.add("candidate", "required")
	}
	// Even mutually exclusive input is validated completely so independent field
	// errors are not hidden behind a first-error-only response.
	if candidate != nil {
		out.Candidate, err = validateManualCandidate(ctx, lookup, candidate, &fields)
		if err != nil {
			return out, nil, err
		}
	}
	if !hasCV {
		fields.add("cv", "required")
	}
	return out, fields, nil
}

func validateManualCandidate(ctx context.Context, lookup geoapp.Lookup, raw map[string]json.RawMessage, fields *manualFields) (*ManualCandidate, error) {
	out := &ManualCandidate{Skills: []string{}, Languages: []ManualLanguage{}}
	if name := fields.text(raw["full_name"], "candidate.full_name", true, 120); name != nil && *name != "" {
		full, err := identityvo.NewFullName(*name)
		if err != nil || utf8.RuneCountInString(*name) < 2 {
			fields.add("candidate.full_name", "invalid")
		} else {
			out.FullName = full.Value()
		}
	}
	if education := fields.text(raw["education_level"], "candidate.education_level", true, 0); education != nil && *education != "" {
		level, ok := manualEducationLevel(*education)
		if !ok {
			fields.add("candidate.education_level", "invalid")
		} else {
			out.EducationLevel = level
		}
	}
	out.Email = fields.text(raw["email"], "candidate.email", false, 0)
	if out.Email != nil {
		if _, err := identityvo.NewEmail(*out.Email); err != nil {
			fields.add("candidate.email", "invalid")
		} else {
			normalized := strings.ToLower(strings.TrimSpace(*out.Email))
			out.EmailNormalized = &normalized
		}
	}
	// The phone VO intentionally accepts exact input only (no whitespace fixups).
	if !manualNull(raw["phone"]) {
		var phone string
		if json.Unmarshal(raw["phone"], &phone) != nil {
			fields.add("candidate.phone", "invalid")
		} else if _, err := sharedvo.NewPhone(phone); err != nil {
			fields.add("candidate.phone", "invalid")
		} else {
			out.Phone = &phone
		}
	}
	if manualNull(raw["email"]) && manualNull(raw["phone"]) {
		fields.add("candidate.contact", "required")
	}
	for _, entry := range []struct {
		key    string
		target **string
		limit  int
	}{
		{"professional_title", &out.ProfessionalTitle, 120}, {"current_company", &out.CurrentCompany, 120}, {"field_of_study", &out.FieldOfStudy, 120},
		{"summary", &out.Summary, 2000}, {"linkedin_url", &out.LinkedInURL, 2048}, {"portfolio_url", &out.PortfolioURL, 2048},
	} {
		*entry.target = fields.text(raw[entry.key], "candidate."+entry.key, false, entry.limit)
		if (entry.key == "linkedin_url" || entry.key == "portfolio_url") && *entry.target != nil {
			value := **entry.target
			parsed, err := url.Parse(value)
			if err != nil || parsed.Scheme != "https" || parsed.Hostname() == "" || parsed.User != nil {
				fields.add("candidate."+entry.key, "invalid")
			}
		}
	}
	if !manualNull(raw["experience_years"]) {
		var years int
		if json.Unmarshal(raw["experience_years"], &years) != nil || years < 0 || years > 60 {
			fields.add("candidate.experience_years", "invalid")
		} else {
			out.ExperienceYears = &years
		}
	}
	if !manualNull(raw["skills"]) {
		var skills []json.RawMessage
		if json.Unmarshal(raw["skills"], &skills) != nil {
			fields.add("candidate.skills", "invalid")
		} else {
			if len(skills) > 30 {
				fields.add("candidate.skills", "too_long")
			}
			seen := map[string]bool{}
			for i, raw := range skills {
				path := "candidate.skills[" + strconv.Itoa(i) + "]"
				skill := fields.text(raw, path, true, 60)
				if skill == nil || *skill == "" {
					continue
				}
				normalized := strings.ToLower(strings.TrimSpace(*skill))
				if seen[normalized] {
					fields.add(path, "duplicate")
				}
				seen[normalized] = true
				out.Skills = append(out.Skills, normalized)
			}
		}
	}
	if !manualNull(raw["languages"]) {
		var languages []json.RawMessage
		if json.Unmarshal(raw["languages"], &languages) != nil {
			fields.add("candidate.languages", "invalid")
		} else {
			if len(languages) > 10 {
				fields.add("candidate.languages", "too_long")
			}
			seen := map[string]bool{}
			for i, raw := range languages {
				path := "candidate.languages[" + strconv.Itoa(i) + "]"
				if manualNull(raw) {
					fields.add(path, "invalid")
					continue
				}
				language, err := manualObject(raw, "language", "level")
				if err != nil {
					return nil, err
				}
				name := fields.text(language["language"], path+".language", true, 120)
				level := fields.text(language["level"], path+".level", true, 0)
				item := ManualLanguage{}
				if name != nil && *name != "" {
					item.Language = strings.ToLower(*name)
					if seen[item.Language] {
						fields.add(path+".language", "duplicate")
					}
					seen[item.Language] = true
				}
				if level != nil && *level != "" {
					// CEFR is case/whitespace-sensitive; do not normalize user input.
					var original string
					_ = json.Unmarshal(language["level"], &original)
					parsed, ok := manualCEFRLevel(original)
					if !ok {
						fields.add(path+".level", "invalid")
					} else {
						item.Level = parsed
					}
				}
				out.Languages = append(out.Languages, item)
			}
		}
	}
	residence, err := validateManualResidence(ctx, lookup, raw["residence"], fields)
	out.Residence = residence
	return out, err
}

func validateManualResidence(ctx context.Context, lookup geoapp.Lookup, raw []byte, fields *manualFields) (*geo.Value, error) {
	const prefix = "candidate.residence"
	if manualNull(raw) {
		fields.add(prefix, "required")
		return nil, nil
	}
	object, err := manualObject(raw, "country", "state", "municipality", "postal_code")
	if err != nil {
		return nil, err
	}
	value := &geo.Value{}
	start := len(*fields)
	for _, entry := range []struct {
		key    string
		target *string
	}{{"country", &value.Country}, {"state", &value.State}, {"municipality", &value.Municipality}, {"postal_code", &value.PostalCode}} {
		if !manualNull(object[entry.key]) {
			if json.Unmarshal(object[entry.key], entry.target) != nil {
				fields.add(prefix+"."+entry.key, "invalid")
			}
		}
	}
	if len(*fields) > start {
		return value, nil
	}
	// Non-MX subdivisions are independently forbidden. The shared validator
	// otherwise reports only the first inconsistent hierarchy level.
	if value.Country != "MX" && value.Country != "" {
		for _, entry := range []struct{ key, value string }{{"state", value.State}, {"municipality", value.Municipality}, {"postal_code", value.PostalCode}} {
			if entry.value != "" {
				fields.add(prefix+"."+entry.key, "not_allowed")
			}
		}
		countryOnly := &geo.Value{Country: value.Country}
		violations, err := geoapp.NewValidator(lookup).Validate(ctx, countryOnly, geo.Rules{Required: true, RequireState: true, RequireMunicipality: true, AllowPostalCode: true, FieldPrefix: prefix})
		for _, violation := range violations {
			fields.add(violation.Field, manualGeoCode(violation.Reason))
		}
		return value, err
	}
	violations, err := geoapp.NewValidator(lookup).Validate(ctx, value, geo.Rules{Required: true, RequireState: true, RequireMunicipality: true, AllowPostalCode: true, FieldPrefix: prefix})
	for _, violation := range violations {
		fields.add(violation.Field, manualGeoCode(violation.Reason))
	}
	if value.Country == "MX" && value.State == "" && value.Municipality == "" {
		fields.add(prefix+".municipality", "required")
	}
	return value, err
}
func manualGeoCode(reason string) string {
	if reason == "required" || reason == "not_allowed" {
		return reason
	}
	return "invalid"
}
