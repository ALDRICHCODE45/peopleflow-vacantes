package application

import (
	"slices"
	"unicode/utf8"
)

func extendedPictographic(r rune) bool {
	i, _ := slices.BinarySearchFunc(extendedPictographicRanges, r, func(a [2]rune, r rune) int {
		if a[1] < r {
			return -1
		}
		if a[0] > r {
			return 1
		}
		return 0
	})
	return i < len(extendedPictographicRanges) && extendedPictographicRanges[i][0] <= r && r <= extendedPictographicRanges[i][1]
}

func regionalIndicator(r rune) bool { return r >= 0x1F1E6 && r <= 0x1F1FF }

// validEmoji matches one complete sequence, not a substring. Selectors,
// modifiers, tags and joiners are accepted only at their grammar positions.
// U+200D joins pictographic elements only; flags, keycaps and tag sequences
// stand alone. No trimming or Unicode replacement is performed.
func validEmoji(s string) bool {
	if s == "" || len(s) > 32 || !utf8.ValidString(s) {
		return false
	}
	r := []rune(s)
	i := 0
	joined := false
	for {
		if i >= len(r) {
			return false
		}
		base := r[i]
		i++
		joinable := false
		switch {
		case joined && !extendedPictographic(base):
			return false
		case regionalIndicator(base):
			if i >= len(r) || !regionalIndicator(r[i]) {
				return false
			}
			i++
		case base == '#' || base == '*' || base >= '0' && base <= '9':
			if i < len(r) && r[i] == 0xFE0F {
				i++
			}
			if i >= len(r) || r[i] != 0x20E3 {
				return false
			}
			i++
		case extendedPictographic(base):
			if i < len(r) && r[i] == 0xFE0F {
				i++
			}
			if i < len(r) && r[i] >= 0x1F3FB && r[i] <= 0x1F3FF {
				i++
			}
			start := i
			for i < len(r) && r[i] >= 0xE0020 && r[i] <= 0xE007E {
				i++
			}
			if i > start {
				if joined || i >= len(r) || r[i] != 0xE007F {
					return false
				}
				i++
			} else {
				joinable = true
			}
		default:
			return false
		}
		if i == len(r) {
			return true
		}
		if r[i] != 0x200D || !joinable {
			return false
		}
		i++
		joined = true
	}
}
