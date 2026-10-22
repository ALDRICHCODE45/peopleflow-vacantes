package v2

import "github.com/aldrichcode45/peopleflow-vacantes/internal/shared/languages"

// SnapshotLocation stores codes only; profile locations never include postal data.
type SnapshotLocation struct {
	Country      string  `json:"country"`
	State        *string `json:"state"`
	Municipality *string `json:"municipality"`
}

// SnapshotEducation distinguishes completed qualifications from ongoing study.
type SnapshotEducation struct {
	HighestCompleted *string `json:"highest_completed"`
	InProgress       *string `json:"in_progress"`
}

type SnapshotLanguage = languages.Proficiency

// ProfileSnapshot is the private, immutable application-time profile allowlist.
// It is never embedded in Submitted or candidate-facing Item responses.
type ProfileSnapshot struct {
	Location          *SnapshotLocation  `json:"location"`
	Skills            []string           `json:"skills"`
	YearsOfExperience *string            `json:"years_of_experience"`
	Seniority         *string            `json:"seniority"`
	Education         SnapshotEducation  `json:"education"`
	Languages         []SnapshotLanguage `json:"languages"`
}

func SnapshotProfile(location *SnapshotLocation, skills []string, years, seniority *string, education SnapshotEducation, languages []SnapshotLanguage) ProfileSnapshot {
	out := ProfileSnapshot{Skills: append([]string{}, skills...), YearsOfExperience: copyString(years), Seniority: copyString(seniority), Education: SnapshotEducation{HighestCompleted: copyString(education.HighestCompleted), InProgress: copyString(education.InProgress)}, Languages: append([]SnapshotLanguage{}, languages...)}
	if location != nil {
		out.Location = &SnapshotLocation{Country: location.Country, State: copyString(location.State), Municipality: copyString(location.Municipality)}
	}
	return out
}

func copyString(value *string) *string {
	if value == nil {
		return nil
	}
	v := *value
	return &v
}
