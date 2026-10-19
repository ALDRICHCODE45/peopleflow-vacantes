package httpjson

const (
	CodeStageSkipNotAllowed               Code = "stage_skip_not_allowed"
	CodePlacementExitConfirmationRequired Code = "placement_exit_confirmation_required"
	CodeVacancyNotPublished               Code = "vacancy_not_published"
	CodeBoardTooLarge                     Code = "board_too_large"
	CodeStageChangeRequiresEmptyPipeline  Code = "stage_change_requires_empty_pipeline"
)

func MovementErrorCodes() []Code {
	return []Code{CodeStageSkipNotAllowed, CodePlacementExitConfirmationRequired, CodeVacancyNotPublished, CodeBoardTooLarge, CodeStageChangeRequiresEmptyPipeline}
}
func resolveMovementError(code Code) (Definition, bool) {
	switch code {
	case CodeStageSkipNotAllowed:
		return Definition{code, 409, "stage skip not allowed"}, true
	case CodePlacementExitConfirmationRequired:
		return Definition{code, 409, "placement exit confirmation required"}, true
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
