package deliveryconfig

import (
	"crypto/sha256"
	"encoding/base64"
	"strconv"

	"github.com/google/uuid"
)

// ETag is opaque and strong, domain-separated from the three other resources.
func ETag(id uuid.UUID, version int64) string {
	digest := sha256.Sum256([]byte("job-draft-delivery:r1:" + id.String() + ":" + strconv.FormatInt(version, 10)))
	return `"dc1-` + base64.RawURLEncoding.EncodeToString(digest[:]) + `"`
}
