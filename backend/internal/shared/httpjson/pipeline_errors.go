package httpjson

import "net/http"

// Pipeline extension codes preserve the baseline V1 catalog's ordered list.
const (
	CodeNonBusinessDate  Code = "non_business_date"
	CodeCutoffStageInUse Code = "cutoff_stage_in_use"
)

// PipelineErrorCodes lists the additive pipeline extension separately from the
// pinned baseline returned by ListCodes. Resolve accepts both catalogs.
func PipelineErrorCodes() []Code {
	return []Code{CodeNonBusinessDate, CodeCutoffStageInUse}
}

func resolvePipelineError(code Code) (Definition, bool) {
	switch code {
	case CodeNonBusinessDate:
		return Definition{code, http.StatusBadRequest, "commitment date is not a business day"}, true
	case CodeCutoffStageInUse:
		return Definition{code, http.StatusConflict, "cutoff stage is in use"}, true
	default:
		return Definition{}, false
	}
}
