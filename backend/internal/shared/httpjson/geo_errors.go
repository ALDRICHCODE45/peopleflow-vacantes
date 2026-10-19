package httpjson

import "net/http"

const (
	CodeCountryNotFound    Code = "country_not_found"
	CodeStateNotFound      Code = "state_not_found"
	CodeInvalidPostalCode  Code = "invalid_postal_code"
	CodePostalCodeNotFound Code = "postal_code_not_found"
	CodeInvalidLocation    Code = "invalid_location"
	CodeInvalidRemoteScope Code = "invalid_remote_scope"
)

func GeoErrorCodes() []Code {
	return []Code{CodeCountryNotFound, CodeStateNotFound, CodeInvalidPostalCode, CodePostalCodeNotFound, CodeInvalidLocation, CodeInvalidRemoteScope}
}

type GeoDetail struct {
	Field  string `json:"field"`
	Reason string `json:"reason"`
}

func WriteGeoError(w http.ResponseWriter, def Definition, details []GeoDetail) {
	def = normalizeDefinition(def)
	if def.Code != CodeInvalidLocation && def.Code != CodeInvalidRemoteScope {
		WriteCatalogError(w, def)
		return
	}
	recordCatalogCode(w, def.Code)
	if details == nil {
		details = []GeoDetail{}
	}
	WriteJSON(w, def.Status, struct {
		Error   string      `json:"error"`
		Code    Code        `json:"code"`
		Details []GeoDetail `json:"details"`
	}{def.Message, def.Code, details})
}

func resolveGeoError(code Code) (Definition, bool) {
	switch code {
	case CodeCountryNotFound:
		return Definition{code, 404, "country not found"}, true
	case CodeStateNotFound:
		return Definition{code, 404, "state not found"}, true
	case CodeInvalidPostalCode:
		return Definition{code, 400, "invalid postal code"}, true
	case CodePostalCodeNotFound:
		return Definition{code, 404, "postal code not found"}, true
	case CodeInvalidRemoteScope:
		return Definition{code, 422, "invalid remote scope"}, true
	case CodeInvalidLocation:
		return Definition{code, 422, "invalid location"}, true
	default:
		return Definition{}, false
	}
}
