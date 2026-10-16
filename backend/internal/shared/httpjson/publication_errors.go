package httpjson

import "net/http"

const (
	CodePublicationIncomplete Code = "publication_incomplete"
	CodeAlreadyPublished      Code = "already_published"
)

func PublicationErrorCodes() []Code { return []Code{CodePublicationIncomplete, CodeAlreadyPublished} }
func resolvePublicationError(code Code) (Definition, bool) {
	switch code {
	case CodePublicationIncomplete:
		return Definition{code, http.StatusUnprocessableEntity, "publication requirements missing"}, true
	case CodeAlreadyPublished:
		return Definition{code, http.StatusConflict, "vacancy already published"}, true
	default:
		return Definition{}, false
	}
}

// WritePublicationError preserves the closed catalog and permits a list only
// on publication_incomplete. No baseline envelope gains an optional list key.
func WritePublicationError(w http.ResponseWriter, def Definition, missing []string) {
	def = normalizeDefinition(def)
	if def.Code != CodePublicationIncomplete {
		WriteCatalogError(w, def)
		return
	}
	recordCatalogCode(w, def.Code)
	if missing == nil {
		missing = []string{}
	}
	WriteJSON(w, def.Status, struct {
		Error   string   `json:"error"`
		Code    Code     `json:"code"`
		Missing []string `json:"missing"`
	}{def.Message, def.Code, missing})
}
