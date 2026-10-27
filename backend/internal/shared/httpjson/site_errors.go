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
)

func SiteErrorCodes() []Code {
	return []Code{CodeSlugTaken, CodeSlugReserved, CodePublishBlocked, CodeSiteNotFound, CodeUnsupportedMediaType, CodeImageTooSmall, CodeImageTooLarge, CodeMediaLimitReached}
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
