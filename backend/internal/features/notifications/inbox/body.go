package inbox

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"net/url"
	"slices"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/notifications/domain"
)

// Limits of the write bodies (§Endpoints, §Limits).
const (
	MaxGroupKeys   = 100
	MaxIDs         = 200
	FacetJobsLimit = 50
	// MaxBodyBytes caps the read / unread / read-all bodies: 100 group keys of
	// ≤ 120 bytes or 200 ids fit with ample margin.
	MaxBodyBytes = 64 << 10
)

// ErrInvalidRequest maps to 400 invalid_request: a body that is not one JSON
// object of the expected shape (malformed, unknown member, wrong JSON type,
// trailing data).
var ErrInvalidRequest = errors.New("invalid notifications request body")

// InvalidBody maps to 400 validation_error with fields[] (sorted by field);
// codes are bounded and never echo the value.
type InvalidBody struct{ Fields []Field }

func (e *InvalidBody) Error() string { return "invalid notifications body" }

// MarkRequest is one validated read / unread body: exactly one of GroupKeys,
// IDs or (unread only) MarkedAt. Lists are canonical, sorted and de-duplicated.
type MarkRequest struct {
	GroupKeys []string
	IDs       []uuid.UUID
	MarkedAt  *time.Time
}

// ReadAllRequest is one validated read-all body; nil lists mean all, a nil
// Before means the statement timestamp.
type ReadAllRequest struct {
	Types  []string
	JobIDs []uuid.UUID
	Before *time.Time
}

// decodeStrict decodes exactly one JSON value into dst, rejecting unknown
// members and trailing data.
func decodeStrict(raw []byte, dst any) error {
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		return ErrInvalidRequest
	}
	if _, err := dec.Token(); !errors.Is(err, io.EOF) {
		return ErrInvalidRequest
	}
	return nil
}

func invalidBody(failures map[string]string) error {
	if len(failures) == 0 {
		return nil
	}
	fields := make([]Field, 0, len(failures))
	for key, code := range failures {
		fields = append(fields, Field{key, code})
	}
	slices.SortFunc(fields, func(a, b Field) int { return strings.Compare(a.Field, b.Field) })
	return &InvalidBody{Fields: fields}
}

// ParseMark validates a read (unread=false) or unread body (§Endpoints): zero
// selections → body required; more than one → body invalid; marked_at on
// read → not_allowed; an empty list → empty; over 100 keys / 200 ids →
// too_many; a malformed key, id or timestamp → invalid. JSON that does not fit
// the shape is ErrInvalidRequest.
func ParseMark(raw []byte, unread bool) (MarkRequest, error) {
	var body struct {
		GroupKeys *[]string `json:"group_keys"`
		IDs       *[]string `json:"ids"`
		MarkedAt  *string   `json:"marked_at"`
	}
	if err := decodeStrict(raw, &body); err != nil {
		return MarkRequest{}, err
	}
	present := 0
	for _, set := range []bool{body.GroupKeys != nil, body.IDs != nil, body.MarkedAt != nil} {
		if set {
			present++
		}
	}
	switch {
	case present == 0:
		return MarkRequest{}, invalidBody(map[string]string{"body": "required"})
	case present > 1:
		return MarkRequest{}, invalidBody(map[string]string{"body": "invalid"})
	}
	failures := map[string]string{}
	var req MarkRequest
	switch {
	case body.GroupKeys != nil:
		req.GroupKeys = parseList(*body.GroupKeys, "group_keys", MaxGroupKeys, failures, canonicalGroupKey)
	case body.IDs != nil:
		ids := parseList(*body.IDs, "ids", MaxIDs, failures, canonicalUUID)
		req.IDs = uuids(ids)
	default:
		if !unread {
			failures["marked_at"] = "not_allowed"
			break
		}
		at, ok := parseTimestamp(*body.MarkedAt)
		if !ok {
			failures["marked_at"] = "invalid"
		}
		req.MarkedAt = &at
	}
	if err := invalidBody(failures); err != nil {
		return MarkRequest{}, err
	}
	return req, nil
}

// ParseReadAll validates a read-all body (§Endpoints): every member optional
// (an empty body is `{}`); types are the 14 domain types (≤ 14), job_ids UUIDs
// (≤ 20), before an RFC 3339 timestamp. Failures are reported together.
func ParseReadAll(raw []byte) (ReadAllRequest, error) {
	if len(bytes.TrimSpace(raw)) == 0 {
		return ReadAllRequest{}, nil
	}
	var body struct {
		Types  *[]string `json:"types"`
		JobIDs *[]string `json:"job_ids"`
		Before *string   `json:"before"`
	}
	if err := decodeStrict(raw, &body); err != nil {
		return ReadAllRequest{}, err
	}
	failures := map[string]string{}
	var req ReadAllRequest
	if body.Types != nil {
		req.Types = parseList(*body.Types, "types", MaxTypes, failures, func(v string) (string, bool) {
			_, known := domain.Lookup(domain.Type(v))
			return v, known
		})
	}
	if body.JobIDs != nil {
		req.JobIDs = uuids(parseList(*body.JobIDs, "job_ids", MaxJobIDs, failures, canonicalUUID))
	}
	if body.Before != nil {
		at, ok := parseTimestamp(*body.Before)
		if !ok {
			failures["before"] = "invalid"
		}
		req.Before = &at
	}
	if err := invalidBody(failures); err != nil {
		return ReadAllRequest{}, err
	}
	return req, nil
}

// ParseFacetsQuery validates GET B/facets: only state (all | unread, default
// unread); every other parameter is ignored (D17).
func ParseFacetsQuery(values url.Values) (string, error) {
	vs, ok := values["state"]
	switch {
	case !ok:
		return StateUnread, nil
	case len(vs) != 1:
		return "", &InvalidFilter{Fields: []Field{{"state", "duplicate"}}}
	case vs[0] != StateAll && vs[0] != StateUnread:
		return "", &InvalidFilter{Fields: []Field{{"state", "invalid"}}}
	}
	return vs[0], nil
}

// parseList checks emptiness, the limit and each value, returning the
// canonical values sorted and de-duplicated (nil on failure).
func parseList(values []string, field string, limit int, failures map[string]string, canonical func(string) (string, bool)) []string {
	switch {
	case len(values) == 0:
		failures[field] = "empty"
		return nil
	case len(values) > limit:
		failures[field] = "too_many"
		return nil
	}
	out := make([]string, 0, len(values))
	for _, v := range values {
		c, ok := canonical(v)
		if !ok {
			failures[field] = "invalid"
			return nil
		}
		out = append(out, c)
	}
	slices.Sort(out)
	return slices.Compact(out)
}

func canonicalUUID(v string) (string, bool) {
	id, err := uuid.Parse(v)
	if err != nil || len(v) != 36 || id == uuid.Nil {
		return "", false
	}
	return id.String(), true
}

func uuids(values []string) []uuid.UUID {
	if values == nil {
		return nil
	}
	out := make([]uuid.UUID, len(values))
	for i, v := range values {
		out[i] = uuid.MustParse(v)
	}
	return out
}

// canonicalGroupKey accepts the D11 shapes of the domain type table:
// `n:<uuid>` for single groups and `<prefix>:<job uuid>:<YYYY-MM-DD>` for the
// grouped prefixes; UUIDs are normalised to lowercase.
func canonicalGroupKey(v string) (string, bool) {
	parts := strings.Split(v, ":")
	switch {
	case len(parts) == 2 && parts[0] == string(domain.GroupSingle):
		id, ok := canonicalUUID(parts[1])
		return parts[0] + ":" + id, ok
	case len(parts) == 3 && parts[0] != string(domain.GroupSingle) && groupedPrefix(parts[0]):
		id, ok := canonicalUUID(parts[1])
		day, err := time.Parse(time.DateOnly, parts[2])
		if !ok || err != nil || day.Format(time.DateOnly) != parts[2] {
			return "", false
		}
		return parts[0] + ":" + id + ":" + parts[2], true
	}
	return "", false
}

func groupedPrefix(prefix string) bool {
	for _, spec := range domain.Types() {
		if string(spec.Group) == prefix {
			return true
		}
	}
	return false
}

func parseTimestamp(v string) (time.Time, bool) {
	at, err := time.Parse(time.RFC3339Nano, v)
	if err != nil {
		return time.Time{}, false
	}
	return at.UTC(), true
}

// AttentionTypes are the types whose unread, unresolved items form the
// attention section (D13): every type of the domain table with an urgency
// other than normal, sorted.
func AttentionTypes() []string {
	var out []string
	for _, spec := range domain.Types() {
		if spec.Urgency != domain.UrgencyNormal {
			out = append(out, string(spec.Type))
		}
	}
	slices.Sort(out)
	return out
}
