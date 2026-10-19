package v2

import "strings"

// ProfileSnapshot is the private, immutable application-time profile allowlist.
// It is never embedded in Submitted or candidate-facing Item responses.
type ProfileSnapshot struct {
	City              *string  `json:"city"`
	Skills            []string `json:"skills"`
	YearsOfExperience *int     `json:"years_of_experience"`
	EducationLevel    *string  `json:"education_level"`
}

func SnapshotProfile(city *string, skills []string, years *int, education *string) ProfileSnapshot {
	out := ProfileSnapshot{Skills: append([]string{}, skills...)}
	if city != nil {
		normalized := strings.Join(strings.Fields(*city), " ")
		if normalized != "" {
			out.City = &normalized
		}
	}
	if years != nil {
		v := *years
		out.YearsOfExperience = &v
	}
	if education != nil {
		v := *education
		out.EducationLevel = &v
	}
	return out
}
