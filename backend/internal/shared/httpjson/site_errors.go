package httpjson

import "net/http"

// SitePublishIssue is the bounded publish-readiness detail, not an error envelope.
type SitePublishIssue struct {
	Code  string  `json:"code"`
	Field *string `json:"field"`
}

const (
	CodeSlugTaken            Code = "slug_taken"
	CodeSlugReserved         Code = "slug_reserved"
	CodePublishBlocked       Code = "publish_blocked"
	CodeSiteNotFound         Code = "site_not_found"
	CodeUnsupportedMediaType Code = "unsupported_media_type"
	CodeImageTooSmall        Code = "image_too_small"
	CodeImageTooLarge        Code = "image_too_large"
	CodeMediaLimitReached    Code = "media_limit_reached"
	// Hero video uploads (slice B, contract §2.4).
	CodeVideoTooLong Code = "video_too_long"
	CodeVideoInvalid Code = "video_invalid"
)

func SiteErrorCodes() []Code {
	return []Code{CodeSlugTaken, CodeSlugReserved, CodePublishBlocked, CodeSiteNotFound, CodeUnsupportedMediaType, CodeImageTooSmall, CodeImageTooLarge, CodeMediaLimitReached, CodeVideoTooLong, CodeVideoInvalid}
}
func resolveSiteError(code Code) (Definition, bool) {
	status := http.StatusUnprocessableEntity
	message := ""
	switch code {
	case CodeSlugTaken:
		status = http.StatusConflict
		message = "slug taken"
	case CodeSlugReserved:
		message = "slug reserved"
	case CodePublishBlocked:
		message = "site publication blocked"
	case CodeSiteNotFound:
		status = http.StatusNotFound
		message = "site not found"
	case CodeUnsupportedMediaType:
		status = http.StatusUnsupportedMediaType
		message = "unsupported media type"
	case CodeImageTooSmall:
		message = "image too small"
	case CodeImageTooLarge:
		message = "image too large"
	case CodeMediaLimitReached:
		message = "media limit reached"
	case CodeVideoTooLong:
		message = "video too long"
	case CodeVideoInvalid:
		message = "video invalid"
	default:
		return Definition{}, false
	}
	return Definition{code, status, message}, true
}

// WriteSiteSlugError adds the single bounded field only to slug errors.
func WriteSiteSlugError(w http.ResponseWriter, code Code) {
	def := Resolve(code)
	if code != CodeSlugTaken && code != CodeSlugReserved {
		WriteCatalogError(w, Resolve(CodeInternalError))
		return
	}
	recordCatalogCode(w, code)
	WriteJSON(w, def.Status, struct {
		Error string `json:"error"`
		Code  Code   `json:"code"`
		Field string `json:"field"`
	}{def.Message, def.Code, "slug"})
}

// WriteSiteVideoTooLong answers 422 video_too_long with `data {max_ms, duration_ms}`.
func WriteSiteVideoTooLong(w http.ResponseWriter, maxMS, durationMS int64) {
	def := Resolve(CodeVideoTooLong)
	recordCatalogCode(w, def.Code)
	WriteJSON(w, def.Status, ErrorEnvelope{Error: def.Message, Code: def.Code, Data: struct {
		MaxMS      int64 `json:"max_ms"`
		DurationMS int64 `json:"duration_ms"`
	}{maxMS, durationMS}})
}

// WriteSitePublishBlocked exposes only bounded readiness issues.
func WriteSitePublishBlocked(w http.ResponseWriter, issues []SitePublishIssue) {
	def := Resolve(CodePublishBlocked)
	recordCatalogCode(w, def.Code)
	WriteJSON(w, def.Status, struct {
		Error  string             `json:"error"`
		Code   Code               `json:"code"`
		Issues []SitePublishIssue `json:"issues"`
	}{def.Message, def.Code, issues})
}

// WriteSiteVersionConflict includes the current site rather than generic data.
func WriteSiteVersionConflict(w http.ResponseWriter, current any) {
	def := Resolve(CodeVersionConflict)
	recordCatalogCode(w, def.Code)
	WriteJSON(w, def.Status, struct {
		Error   string `json:"error"`
		Code    Code   `json:"code"`
		Current any    `json:"current"`
	}{def.Message, def.Code, current})
}
