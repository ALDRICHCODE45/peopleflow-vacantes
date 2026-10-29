package httpjson

import (
	"net/http"
	"strconv"
	"time"
)

const CodeRateLimited Code = "rate_limited"

func RateLimitErrorCodes() []Code { return []Code{CodeRateLimited} }

func resolveRateLimitError(code Code) (Definition, bool) {
	if code == CodeRateLimited {
		return Definition{code, http.StatusTooManyRequests, "too many requests"}, true
	}
	return Definition{}, false
}

// WriteRateLimited writes the plain catalog envelope, without request details.
func WriteRateLimited(w http.ResponseWriter, wait time.Duration) {
	seconds := wait / time.Second
	if wait%time.Second > 0 {
		seconds++
	}
	if seconds < 1 {
		seconds = 1
	}
	w.Header().Set("Retry-After", strconv.FormatInt(int64(seconds), 10))
	WriteCatalogError(w, Resolve(CodeRateLimited))
}
