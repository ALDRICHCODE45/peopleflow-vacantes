package v2

// SnapshotLocation stores codes only; profile locations never include postal data.
type SnapshotLocation struct {
	Country      string  `json:"country"`
	State        *string `json:"state"`
	Municipality *string `json:"municipality"`
}

// ProfileSnapshot is the private, immutable application-time profile allowlist.
// It is never embedded in Submitted or candidate-facing Item responses.
type ProfileSnapshot struct {
	Location          *SnapshotLocation `json:"location"`
	Skills            []string          `json:"skills"`
	YearsOfExperience *int              `json:"years_of_experience"`
	EducationLevel    *string           `json:"education_level"`
}

func SnapshotProfile(location *SnapshotLocation, skills []string, years *int, education *string) ProfileSnapshot {
	out := ProfileSnapshot{Skills: append([]string{}, skills...)}
	if location != nil {
		v := *location
		if v.State != nil {
			s := *v.State
			v.State = &s
		}
		if v.Municipality != nil {
			m := *v.Municipality
			v.Municipality = &m
		}
		out.Location = &v
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
