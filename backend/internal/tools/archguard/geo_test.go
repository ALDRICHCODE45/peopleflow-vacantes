package archguard

import "testing"

func TestGeoValidatorExceptionsDoNotAllowInfrastructure(t *testing.T) {
	got := CheckCrossFeatureImports(map[string][]string{
		module + "/features/jobs/application/vacancygeo":             {module + "/features/geo/application", module + "/features/geo/domain"},
		module + "/features/candidates/application/usecases":         {module + "/features/geo/application", module + "/features/geo/domain"},
		module + "/features/companies/application/usecases":          {module + "/features/geo/application", module + "/features/geo/domain"},
		module + "/features/jobs/infrastructure/postgres/draftstore": {module + "/features/geo/infrastructure/postgres"},
	})
	if len(got) != 1 {
		t.Fatalf("expected only the sibling infrastructure violation: %+v", got)
	}
	wantRuleNamed(t, got, ruleCrossFeatureImport, module+"/features/geo/infrastructure/postgres")
}
