package httpjson

import "net/http"

// Code is the stable V1 error-code type.
type Code string

// V1 catalog constants.
const (
	CodeInvalidRequest          Code = "invalid_request"
	CodeInvalidStatusTransition Code = "invalid_status_transition"
	CodeUnauthenticated         Code = "unauthenticated"
	CodeForbidden               Code = "forbidden"
	CodeCompanyInactive         Code = "company_inactive"
	CodeNotFound                Code = "not_found"
	CodeConflict                Code = "conflict"
	CodeCompanyNotActive        Code = "company_not_active"
	CodeIndustryUnavailable     Code = "industry_unavailable"
	CodeAlreadyExists           Code = "already_exists"
	CodePayloadTooLarge         Code = "payload_too_large"
	CodeMethodNotAllowed        Code = "method_not_allowed"
	CodeServiceUnavailable      Code = "service_unavailable"
	CodeInternalError           Code = "internal_error"
)

// ErrorCatalogVersion is the stable catalog version identifier.
const ErrorCatalogVersion = 1

// ErrorEnvelope is the stable V1 response shape.
type ErrorEnvelope struct {
	Error string `json:"error"`
	Code  Code   `json:"code"`
	Data  any    `json:"data,omitempty"`
}

// Definition describes one stable catalog entry.
type Definition struct {
	Code    Code
	Status  int
	Message string
}

// Resolve returns the definition for code. Unknown codes are fail-closed to internal_error/500.
func Resolve(code Code) Definition {
	switch code {
	case CodeInvalidRequest:
		return Definition{code, http.StatusBadRequest, "invalid request"}
	case CodeInvalidStatusTransition:
		return Definition{code, http.StatusBadRequest, "invalid status transition"}
	case CodeUnauthenticated:
		return Definition{code, http.StatusUnauthorized, "unauthenticated"}
	case CodeForbidden:
		return Definition{code, http.StatusForbidden, "forbidden"}
	case CodeCompanyInactive:
		return Definition{code, http.StatusForbidden, "company is inactive"}
	case CodeNotFound:
		return Definition{code, http.StatusNotFound, "not found"}
	case CodeConflict:
		return Definition{code, http.StatusConflict, "resource conflict"}
	case CodeCompanyNotActive:
		return Definition{code, http.StatusConflict, "company is not active"}
	case CodeIndustryUnavailable:
		return Definition{code, http.StatusConflict, "industry unavailable"}
	case CodeAlreadyExists:
		return Definition{code, http.StatusConflict, "resource already exists"}
	case CodePayloadTooLarge:
		return Definition{code, http.StatusRequestEntityTooLarge, "payload too large"}
	case CodeMethodNotAllowed:
		return Definition{code, http.StatusMethodNotAllowed, "method not allowed"}
	case CodeServiceUnavailable:
		return Definition{code, http.StatusServiceUnavailable, "service unavailable"}
	case CodeInternalError:
		return Definition{code, http.StatusInternalServerError, "an internal error occurred"}
	default:
		return Definition{CodeInternalError, http.StatusInternalServerError, "an internal error occurred"}
	}
}

// ListCodes returns a fresh ordered slice of all V1 codes.
func ListCodes() []Code {
	return []Code{
		CodeInvalidRequest, CodeInvalidStatusTransition, CodeUnauthenticated,
		CodeForbidden, CodeCompanyInactive, CodeNotFound, CodeConflict,
		CodeCompanyNotActive, CodeIndustryUnavailable, CodeAlreadyExists,
		CodePayloadTooLarge, CodeMethodNotAllowed, CodeServiceUnavailable,
		CodeInternalError,
	}
}

// CatalogCodeRecorder is an optional http.ResponseWriter capability used by
// request-observability middleware to capture the canonical catalog code of
// the last normalized catalog error written. It carries only the closed,
// bounded V1 code string — never definitions, messages, data, raw errors, or
// any other response detail. Ordinary writers without this capability are
// unaffected.
type CatalogCodeRecorder interface {
	RecordCatalogCode(code string)
}

// recordCatalogCode propagates the already-normalized code to the optional
// capability, if present.
func recordCatalogCode(w http.ResponseWriter, code Code) {
	if rec, ok := w.(CatalogCodeRecorder); ok {
		rec.RecordCatalogCode(string(code))
	}
}

// WriteCatalogError writes a normalized catalog error without data.
func WriteCatalogError(w http.ResponseWriter, def Definition) {
	def = normalizeDefinition(def)
	recordCatalogCode(w, def.Code)
	WriteJSON(w, def.Status, ErrorEnvelope{Error: def.Message, Code: def.Code})
}

// WriteCatalogErrorData writes a normalized catalog error with safe conflict data.
func WriteCatalogErrorData(w http.ResponseWriter, def Definition, data any) {
	def = normalizeDefinition(def)
	recordCatalogCode(w, def.Code)
	if def.Code != CodeConflict {
		data = nil
	}
	WriteJSON(w, def.Status, ErrorEnvelope{Error: def.Message, Code: def.Code, Data: data})
}

func normalizeDefinition(def Definition) Definition {
	canonical := Resolve(def.Code)
	if canonical.Code != def.Code || canonical.Status != def.Status || def.Code == CodeInternalError {
		return Resolve(CodeInternalError)
	}
	if def.Message == "" {
		def.Message = canonical.Message
	}
	return def
}

// SafeMessage substitutes msgOverride for Message. Empty falls back to original.
// For internal_error the message is always generic.
func SafeMessage(def Definition, msgOverride string) Definition {
	if def.Code == CodeInternalError {
		return Definition{def.Code, def.Status, "an internal error occurred"}
	}
	if msgOverride == "" {
		msgOverride = def.Message
	}
	return Definition{def.Code, def.Status, msgOverride}
}
