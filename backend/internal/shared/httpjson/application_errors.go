package httpjson

import "net/http"

const (
	CodeCVTooLarge           Code = "cv_too_large"
	CodeCVUnsupportedType    Code = "cv_unsupported_type"
	CodeCVContentMismatch    Code = "cv_content_mismatch"
	CodeCVLibraryFull        Code = "cv_library_full"
	CodeQuestionnaireChanged Code = "questionnaire_changed"
	CodeAlreadyApplied       Code = "already_applied"
	CodeInvalidAnswers       Code = "invalid_answers"
	CodeCVUnavailable        Code = "cv_unavailable"
)

type AnswerDetail struct {
	QuestionID string `json:"question_id"`
	Reason     string `json:"reason"`
}

func ApplicationErrorCodes() []Code {
	return []Code{CodeCVTooLarge, CodeCVUnsupportedType, CodeCVContentMismatch, CodeCVLibraryFull, CodeQuestionnaireChanged, CodeAlreadyApplied, CodeInvalidAnswers, CodeCVUnavailable}
}

// Called by Resolve's additive extension chain.
func resolveApplicationError(code Code) (Definition, bool) {
	switch code {
	case CodeCVTooLarge:
		return Definition{code, 413, "CV too large"}, true
	case CodeCVUnsupportedType:
		return Definition{code, 415, "unsupported CV type"}, true
	case CodeCVContentMismatch:
		return Definition{code, 400, "CV content mismatch"}, true
	case CodeCVLibraryFull:
		return Definition{code, 409, "CV library full"}, true
	case CodeQuestionnaireChanged:
		return Definition{code, 409, "questionnaire changed"}, true
	case CodeAlreadyApplied:
		return Definition{code, 409, "already applied"}, true
	case CodeInvalidAnswers:
		return Definition{code, 422, "invalid answers"}, true
	case CodeCVUnavailable:
		return Definition{code, 422, "CV unavailable"}, true
	default:
		return Definition{}, false
	}
}

// Only invalid_answers gets a details list; other error envelopes are unchanged.
func WriteApplicationError(w http.ResponseWriter, def Definition, details []AnswerDetail) {
	def = normalizeDefinition(def)
	if def.Code != CodeInvalidAnswers {
		WriteCatalogError(w, def)
		return
	}
	if details == nil {
		details = []AnswerDetail{}
	}
	recordCatalogCode(w, def.Code)
	WriteJSON(w, def.Status, struct {
		Error   string         `json:"error"`
		Code    Code           `json:"code"`
		Details []AnswerDetail `json:"details"`
	}{def.Message, def.Code, details})
}
