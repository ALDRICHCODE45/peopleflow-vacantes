package scoring

import (
	"fmt"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/psychometrics/content"
)

// Recompare applies the pinned comparison rules to immutable observed scores and
// quality. It never rescores answers, chooses interpretations or mutates Result.
func Recompare(a *content.Artifact, result Result, profile *Profile) (Comparison, error) {
	d, err := document(a)
	if err != nil {
		return Comparison{}, err
	}
	if result.ContentVersion != d.ContentVersion || result.ScoringVersion != d.ScoringVersion {
		return Comparison{}, fmt.Errorf("psychometrics scoring: result versions differ from pinned artifact")
	}
	requirements, err := validateProfile(d, profile)
	if err != nil {
		return Comparison{}, err
	}
	return compare(d, result.Competencies, result.Quality, profile, requirements)
}
