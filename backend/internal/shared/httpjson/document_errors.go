package httpjson

import "net/http"

// Placement and vacancy documents (docs/contracts/placement-vacancy-documents-v1.md,
// «Error codes»). Only the codes with no generic equivalent live here; the rest of the
// document routes reuse not_found, team_access_ended, forbidden, validation_error,
// invalid_request, unsupported_media_type, payload_too_large, invalid_idempotency_key
// and idempotency_conflict. `process_finished` and `vacancy_not_published` are
// deliberately not used (S4), and neither is a `document_upload_not_allowed` code (D3).
//
// Every enum the frontend decodes is closed here: the data writers below refuse a value
// outside it with the generic 500 instead of sending it.
const (
	CodeDocumentContentMismatch    Code = "document_content_mismatch"
	CodeDocumentLimitReached       Code = "document_limit_reached"
	CodeDocumentVersionConflict    Code = "document_version_conflict"
	CodeDocumentAlreadyLinked      Code = "document_already_linked"
	CodeDocumentLinkInvalid        Code = "document_link_invalid"
	CodeDocumentStorageUnavailable Code = "document_storage_unavailable"
)

// DocumentErrorCodes lists the family in contract order. The slice is a fresh copy.
func DocumentErrorCodes() []Code {
	return []Code{
		CodeDocumentContentMismatch, CodeDocumentLimitReached, CodeDocumentVersionConflict,
		CodeDocumentAlreadyLinked, CodeDocumentLinkInvalid, CodeDocumentStorageUnavailable,
	}
}

// DocumentFormatValues is the closed `format` enum (and `data.detected_format`, which may also be null).
func DocumentFormatValues() []string { return []string{"pdf", "docx", "xlsx", "jpg", "png"} }

// DocumentLimitKinds is the closed `document_limit_reached` `data.kind` enum.
func DocumentLimitKinds() []string { return []string{"documents", "versions"} }

// DocumentLinkInvalidReasons is the closed `document_link_invalid` `data.reason` enum.
func DocumentLinkInvalidReasons() []string {
	return []string{"not_replacement", "source_not_in_chain", "version_not_found"}
}

func resolveDocumentError(code Code) (Definition, bool) {
	switch code {
	case CodeDocumentContentMismatch:
		return Definition{code, http.StatusBadRequest, "document content does not match its extension"}, true
	case CodeDocumentLimitReached:
		return Definition{code, http.StatusConflict, "document limit reached"}, true
	case CodeDocumentVersionConflict:
		return Definition{code, http.StatusConflict, "document version conflict"}, true
	case CodeDocumentAlreadyLinked:
		return Definition{code, http.StatusConflict, "document already linked"}, true
	case CodeDocumentLinkInvalid:
		return Definition{code, http.StatusUnprocessableEntity, "document link invalid"}, true
	case CodeDocumentStorageUnavailable:
		return Definition{code, http.StatusServiceUnavailable, "document storage unavailable"}, true
	}
	return Definition{}, false
}

func inDocumentEnum(values []string, v string) bool {
	for _, candidate := range values {
		if candidate == v {
			return true
		}
	}
	return false
}

// writeDocumentEnvelope is the sole writer that attaches data to the document family and to the two generic codes the
// document routes decorate (unsupported_media_type, payload_too_large). Any other code, or a definition that is not the
// canonical one, is written without data (or as the generic 500), so data cannot leak through here for a code that
// carries none.
func writeDocumentEnvelope(w http.ResponseWriter, def Definition, data any) {
	def = normalizeDefinition(def)
	_, document := resolveDocumentError(def.Code)
	if !document && def.Code != CodeUnsupportedMediaType && def.Code != CodePayloadTooLarge {
		WriteCatalogError(w, def)
		return
	}
	recordCatalogCode(w, def.Code)
	WriteJSON(w, def.Status, ErrorEnvelope{Error: def.Message, Code: def.Code, Data: data})
}

func writeDocumentInvalid(w http.ResponseWriter) { WriteCatalogError(w, Resolve(CodeInternalError)) }

// WriteDocumentContentMismatch answers 400 document_content_mismatch with `data {detected_format, extension}`.
// detected is the format the bytes decide ("" when they match no accepted format: null on the wire); extension is the
// file name's extension, lower-cased with its dot, "" when there is none. Both keys are always present.
func WriteDocumentContentMismatch(w http.ResponseWriter, detected, extension string) {
	var format *string
	if detected != "" {
		if !inDocumentEnum(DocumentFormatValues(), detected) {
			writeDocumentInvalid(w)
			return
		}
		format = &detected
	}
	writeDocumentEnvelope(w, Resolve(CodeDocumentContentMismatch), struct {
		DetectedFormat *string `json:"detected_format"`
		Extension      string  `json:"extension"`
	}{format, extension})
}

// WriteDocumentLimitReached answers 409 document_limit_reached with `data {kind, limit}`.
func WriteDocumentLimitReached(w http.ResponseWriter, kind string, limit int) {
	if !inDocumentEnum(DocumentLimitKinds(), kind) {
		writeDocumentInvalid(w)
		return
	}
	writeDocumentEnvelope(w, Resolve(CodeDocumentLimitReached), struct {
		Kind  string `json:"kind"`
		Limit int    `json:"limit"`
	}{kind, limit})
}

// WriteDocumentVersionConflict answers 409 document_version_conflict with `data {current_version}`.
func WriteDocumentVersionConflict(w http.ResponseWriter, currentVersion int) {
	writeDocumentEnvelope(w, Resolve(CodeDocumentVersionConflict), struct {
		CurrentVersion int `json:"current_version"`
	}{currentVersion})
}

// WriteDocumentAlreadyLinked answers 409 document_already_linked with `data {link_id}`.
func WriteDocumentAlreadyLinked(w http.ResponseWriter, linkID string) {
	writeDocumentEnvelope(w, Resolve(CodeDocumentAlreadyLinked), struct {
		LinkID string `json:"link_id"`
	}{linkID})
}

// WriteDocumentLinkInvalid answers 422 document_link_invalid with `data {reason}`.
func WriteDocumentLinkInvalid(w http.ResponseWriter, reason string) {
	if !inDocumentEnum(DocumentLinkInvalidReasons(), reason) {
		writeDocumentInvalid(w)
		return
	}
	writeDocumentEnvelope(w, Resolve(CodeDocumentLinkInvalid), struct {
		Reason string `json:"reason"`
	}{reason})
}

// DocumentFormat is one entry of `data.formats` (the `limits.formats` descriptor shape).
type DocumentFormat struct {
	Format      string   `json:"format"`
	Extensions  []string `json:"extensions"`
	ContentType string   `json:"content_type"`
}

// WriteDocumentUnsupportedType answers 415 unsupported_media_type with `data {formats}`; the list is never null.
func WriteDocumentUnsupportedType(w http.ResponseWriter, formats []DocumentFormat) {
	if formats == nil {
		formats = []DocumentFormat{}
	}
	writeDocumentEnvelope(w, Resolve(CodeUnsupportedMediaType), struct {
		Formats []DocumentFormat `json:"formats"`
	}{formats})
}

// WriteDocumentPayloadTooLarge answers 413 payload_too_large with `data {max_bytes}`.
func WriteDocumentPayloadTooLarge(w http.ResponseWriter, maxBytes int64) {
	writeDocumentEnvelope(w, Resolve(CodePayloadTooLarge), struct {
		MaxBytes int64 `json:"max_bytes"`
	}{maxBytes})
}
