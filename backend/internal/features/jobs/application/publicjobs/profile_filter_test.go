package publicjobs

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/url"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestParseQueryProfileFilters(t *testing.T) {
	for _, raw := range []string{"language=en&language=nah", "seniority=intern&seniority=junior&seniority=semi_senior&seniority=senior&seniority=lead&seniority=manager&seniority=director", "years_of_experience=0", "years_of_experience=1.5", "years_of_experience=60.0", "education_level=secondary", "education_level=high_school", "education_level=technical", "education_level=tsu", "education_level=bachelor", "education_level=specialty", "education_level=master", "education_level=phd"} {
		t.Run(raw, func(t *testing.T) {
			if _, err := ParseQuery(raw); err != nil {
				t.Fatal(err)
			}
		})
	}
	for _, raw := range []string{"language=", "language=en&language=en", "language=EN", "language=zz", "language=%20en", "language=en,fr", "language=%ZZ", "language=%FF", "language=en%00", "language=en;fr", "seniority=", "seniority=mid", "seniority=Senior", "seniority=junior&seniority=junior", "years_of_experience=", "years_of_experience=2&years_of_experience=2", "years_of_experience=01", "years_of_experience=1.50", "years_of_experience=60.1", "years_of_experience=-1", "years_of_experience=1e1", "years_of_experience=.5", "years_of_experience=1.", "years_of_experience=%202", "education_level=", "education_level=Bachelor", "education_level=none", "education_level=bachelor&education_level=master"} {
		t.Run(raw, func(t *testing.T) {
			if _, err := ParseQuery(raw); !errors.Is(err, ErrInvalidFilter) {
				t.Fatalf("want invalid_filter, got %v", err)
			}
		})
	}
}

func TestProfileCursorBindingIsCanonicalAndBackwardCompatible(t *testing.T) {
	raw := "language=fr&language=en&seniority=senior&seniority=junior&years_of_experience=2&education_level=bachelor"
	q, err := ParseQuery(raw)
	if err != nil {
		t.Fatal(err)
	}
	p := Position{ID: uuid.New(), Source: "vacancy", PublishedAt: time.Now().UTC()}
	token, err := encodeCursor(q, p)
	if err != nil {
		t.Fatal(err)
	}
	equivalent := "education_level=bachelor&years_of_experience=2.0&seniority=junior&seniority=senior&language=en&language=fr"
	if got, err := ParseQuery(equivalent + "&cursor=" + url.QueryEscape(token)); err != nil || got.After == nil || got.After.ID != p.ID {
		t.Fatalf("equivalent: %+v %v", got, err)
	}
	for _, key := range []string{"language", "seniority", "years_of_experience", "education_level"} {
		v, _ := url.ParseQuery(raw)
		v.Del(key)
		if _, err := ParseQuery(v.Encode() + "&cursor=" + url.QueryEscape(token)); !errors.Is(err, ErrInvalidRequest) {
			t.Fatalf("dropped %s: %v", key, err)
		}
		changed := map[string]string{"language": "es", "seniority": "director", "years_of_experience": "2.1", "education_level": "master"}
		v.Set(key, changed[key])
		if _, err := ParseQuery(v.Encode() + "&cursor=" + url.QueryEscape(token)); !errors.Is(err, ErrInvalidRequest) {
			t.Fatalf("changed %s: %v", key, err)
		}
	}
	for _, raw := range []string{"q=Go&state=09&work_mode=remote", "q=Go&salary_min=30" + salaryUnits} {
		q, err := ParseQuery(raw)
		if err != nil {
			t.Fatal(err)
		}
		// Frozen pre-H5 binding, including the optional salary suffix.
		filters := []any{q.Q, []string{}, []string{}, []string{}, q.ApplicantCountry, q.WorkSchedule, q.ContractType, q.ProfessionalArea}
		if q.States != nil {
			filters[1] = q.States
		}
		if q.WorkModes != nil {
			filters[3] = q.WorkModes
		}
		if s := q.Salary; s != nil {
			filters = append(filters, []string{s.Min, s.Max, s.Currency, s.Period, s.Basis})
		}
		b, _ := json.Marshal(filters)
		sum := sha256.Sum256(b)
		if filterHash(q) != hex.EncodeToString(sum[:]) {
			t.Fatal("pre-H5 hash changed")
		}
	}
}
