package languages

import "strings"

// CodeForLegacyName bridges the pre-harmonization API to catalog storage.
// It is intentionally not used to validate the new exact-code API.
func CodeForLegacyName(name string) (string, bool) {
	fold := func(s string) string {
		return strings.NewReplacer("á", "a", "é", "e", "í", "i", "ó", "o", "ú", "u", "ü", "u", "ñ", "n", "å", "a", "\u0301", "", "\u0303", "", "\u0308", "", "\u030a", "").Replace(strings.ToLower(s))
	}
	name = fold(name)
	for _, item := range catalog {
		if fold(item.Name) == name {
			return item.Code, true
		}
	}
	aliases := map[string]string{"spanish": "es", "english": "en", "french": "fr", "german": "de", "italian": "it", "portuguese": "pt", "chinese": "zh", "japanese": "ja", "korean": "ko", "russian": "ru", "arabic": "ar"}
	code, ok := aliases[name]
	return code, ok
}
