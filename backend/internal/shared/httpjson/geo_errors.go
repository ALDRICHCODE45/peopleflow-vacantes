package httpjson

const (
	CodeCountryNotFound    Code = "country_not_found"
	CodeStateNotFound      Code = "state_not_found"
	CodeInvalidPostalCode  Code = "invalid_postal_code"
	CodePostalCodeNotFound Code = "postal_code_not_found"
	CodeInvalidLocation    Code = "invalid_location"
)

func GeoErrorCodes() []Code {
	return []Code{CodeCountryNotFound, CodeStateNotFound, CodeInvalidPostalCode, CodePostalCodeNotFound, CodeInvalidLocation}
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
	case CodeInvalidLocation:
		return Definition{code, 422, "invalid location"}, true
	default:
		return Definition{}, false
	}
}
