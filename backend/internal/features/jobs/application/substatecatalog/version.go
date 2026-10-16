package substatecatalog

import (
	"crypto/sha256"
	"encoding/base64"
	"strconv"

	"github.com/google/uuid"
)

// ETag is strong and opaque, domain-separated from both draft and pipeline tags.
// Version zero represents the empty, never-stored catalog.
func ETag(id uuid.UUID, version int64) string {
	digest := sha256.Sum256([]byte("job-draft-substates:r1:" + id.String() + ":" + strconv.FormatInt(version, 10)))
	return `"sc1-` + base64.RawURLEncoding.EncodeToString(digest[:]) + `"`
}
