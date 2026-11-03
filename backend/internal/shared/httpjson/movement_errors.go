package httpjson

const (
	CodeStageSkipNotAllowed              Code = "stage_skip_not_allowed"
	CodePlacementExitReasonRequired      Code = "placement_exit_reason_required"
	CodeVacancyNotPublished              Code = "vacancy_not_published"
	CodeBoardTooLarge                    Code = "board_too_large"
	CodeStageChangeRequiresEmptyPipeline Code = "stage_change_requires_empty_pipeline"
)

func MovementErrorCodes() []Code {
	return []Code{CodeStageSkipNotAllowed, CodePlacementExitReasonRequired, CodeVacancyNotPublished, CodeBoardTooLarge, CodeStageChangeRequiresEmptyPipeline}
}
func resolveMovementError(code Code) (Definition, bool) {
	switch code {
	case CodeStageSkipNotAllowed:
		return Definition{code, 409, "stage skip not allowed"}, true
	case CodePlacementExitReasonRequired:
		return Definition{code, 409, "placement exit reason required"}, true
	case CodeVacancyNotPublished:
		return Definition{code, 409, "vacancy not published"}, true
	case CodeBoardTooLarge:
		return Definition{code, 422, "board too large"}, true
	case CodeStageChangeRequiresEmptyPipeline:
		return Definition{code, 409, "stage change requires empty pipeline"}, true
	default:
		return Definition{}, false
	}
}
