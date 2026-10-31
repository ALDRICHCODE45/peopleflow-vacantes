package httpjson

import "net/http"

const (
	CodeMessageUnavailable         Code = "message_unavailable"
	CodeMessageChanged             Code = "message_changed"
	CodeCVStorageUnavailable       Code = "cv_storage_unavailable"
	CodeCVTooLarge                 Code = "cv_too_large"
	CodeCVUnsupportedType          Code = "cv_unsupported_type"
	CodeCVContentMismatch          Code = "cv_content_mismatch"
	CodeCVLibraryFull              Code = "cv_library_full"
	CodeQuestionnaireChanged       Code = "questionnaire_changed"
	CodeAlreadyApplied             Code = "already_applied"
	CodeInvalidAnswers             Code = "invalid_answers"
	CodeCVUnavailable              Code = "cv_unavailable"
	CodeApplicantCountryRequired   Code = "applicant_country_required"
	CodeApplicantCountryNotAllowed Code = "applicant_country_not_allowed"
)

type AnswerDetail struct {
	QuestionID string `json:"question_id"`
	Reason     string `json:"reason"`
}

func ApplicationErrorCodes() []Code {
	return []Code{CodeMessageUnavailable, CodeMessageChanged, CodeCVStorageUnavailable, CodeCVTooLarge, CodeCVUnsupportedType, CodeCVContentMismatch, CodeCVLibraryFull, CodeQuestionnaireChanged, CodeAlreadyApplied, CodeInvalidAnswers, CodeCVUnavailable, CodeApplicantCountryRequired, CodeApplicantCountryNotAllowed}
}

// Called by Resolve's additive extension chain.
func resolveApplicationError(code Code) (Definition, bool) {
	switch code {
	case CodeMessageUnavailable:
		return Definition{code, 409, "message unavailable"}, true
	case CodeMessageChanged:
		return Definition{code, 409, "message changed"}, true
	case CodeCVStorageUnavailable:
		return Definition{code, http.StatusServiceUnavailable, "CV storage unavailable"}, true
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
	case CodeApplicantCountryRequired:
		return Definition{code, 422, "applicant country required"}, true
	case CodeApplicantCountryNotAllowed:
		return Definition{code, 422, "applicant country not allowed"}, true
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
