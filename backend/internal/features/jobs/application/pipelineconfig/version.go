package pipelineconfig

import (
	"crypto/sha256"
	"encoding/base64"
	"strconv"
	"strings"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/drafts"
	"github.com/google/uuid"
)

// ETag is an opaque strong pipeline tag, domain-separated from draft tags.
// Version zero represents deterministic, never-stored defaults.
func ETag(id uuid.UUID, version int64) string {
	digest := sha256.Sum256([]byte("job-draft-pipeline:r1:" + id.String() + ":" + strconv.FormatInt(version, 10)))
	return `"pc1-` + base64.RawURLEncoding.EncodeToString(digest[:]) + `"`
}

// CheckIfMatch accepts exactly one nonempty strong entity tag. Well-formed
// foreign tags conflict; malformed, weak, wildcard and list values are invalid.
// Call only after resource authorization so versions cannot reveal existence.
func CheckIfMatch(issued, value string, present bool) error {
	if !present {
		return drafts.ErrPreconditionRequired
	}
	raw := strings.Trim(value, " \t")
	if len(raw) < 3 || raw[0] != '"' || raw[len(raw)-1] != '"' {
		return drafts.ErrInvalidRequest
	}
	for i := 1; i < len(raw)-1; i++ {
		if raw[i] < 0x21 || raw[i] == '"' || raw[i] == 0x7f || raw[i] == ',' {
			return drafts.ErrInvalidRequest
		}
	}
	if raw != issued {
		return drafts.ErrVersionConflict
	}
	return nil
}
