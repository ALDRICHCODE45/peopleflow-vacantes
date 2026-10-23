package pool

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"net/url"
	"slices"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/shared/languages"
	"github.com/google/uuid"
)

const cursorLayout = "2006-01-02T15:04:05.000000Z"
const MaxCursorBytes = 4096

type Filters struct {
	Q                                                                 string
	Origin                                                            string
	Vacancy, Country, State, Municipality, Seniority, Years, Language []string
	LanguageMinLevel, EducationLevel                                  string
	EducationInProgress                                               bool
	ActiveProcess                                                     bool
}
type Query struct {
	Filters
	Limit int
	After *Position
}
type Position struct {
	At   time.Time
	Kind string
	ID   uuid.UUID
}

// ParseQuery normalizes only semantic equivalences (selection order, q case and
// surrounding whitespace). Codes are exact. No rejected value enters an error.
func ParseQuery(company uuid.UUID, raw string) (Query, error) {
	values := url.Values{}
	failures := map[string]string{}
	for _, pair := range strings.Split(raw, "&") {
		if pair == "" {
			continue
		}
		key, value, _ := strings.Cut(pair, "=")
		k, ke := url.QueryUnescape(key)
		v, ve := url.QueryUnescape(value)
		if ke != nil {
			failures["query"] = "invalid"
			continue
		}
		if ve != nil || strings.Contains(pair, ";") {
			failures[k] = "invalid"
		}
		values[k] = append(values[k], v)
	}
	q := Query{Limit: 20}
	for key, vs := range values {
		single := slices.Contains([]string{"q", "origin", "language_min_level", "education_level", "education_in_progress", "active_process", "limit", "cursor"}, key)
		known := single || slices.Contains([]string{"vacancy", "country", "state", "municipality", "seniority", "years", "language"}, key)
		if !known {
			failures[key] = "unknown"
			continue
		}
		if single && len(vs) != 1 {
			failures[key] = "duplicate"
			continue
		}
		if _, bad := failures[key]; bad {
			continue
		}
		valid := true
		for _, v := range vs {
			switch key {
			case "q":
				q.Q = strings.ToLower(strings.TrimSpace(v))
				valid = utf8.ValidString(v) && utf8.RuneCountInString(q.Q) >= 1 && utf8.RuneCountInString(q.Q) <= 100 && !strings.ContainsRune(v, 0)
			case "origin":
				q.Origin = v
				valid = v == "manual" || v == "organic"
			case "vacancy":
				id, err := uuid.Parse(v)
				valid = err == nil && id != uuid.Nil && id.String() == v
				q.Vacancy = append(q.Vacancy, v)
			case "country":
				valid = v == "none" || (len(v) == 2 && v[0] >= 'A' && v[0] <= 'Z' && v[1] >= 'A' && v[1] <= 'Z')
				q.Country = append(q.Country, v)
			case "active_process":
				valid = v == "true"
				q.ActiveProcess = v == "true"
			case "state":
				valid = v == "none" || digits(v, 2)
				q.State = append(q.State, v)
			case "municipality":
				valid = v == "none" || digits(v, 5)
				q.Municipality = append(q.Municipality, v)
			case "seniority":
				valid = v == "none" || languages.ValidSeniority(v)
				q.Seniority = append(q.Seniority, v)
			case "years":
				valid = slices.Contains([]string{"0_1", "1_3", "3_5", "5_plus", "none"}, v)
				q.Years = append(q.Years, v)
			case "language":
				_, ok := languages.Lookup(v)
				valid = v == "none" || ok
				q.Language = append(q.Language, v)
			case "language_min_level":
				q.LanguageMinLevel = v
				valid = languages.ValidLanguageLevel(v)
			case "education_level":
				q.EducationLevel = v
				valid = languages.ValidEducationLevel(v)
			case "education_in_progress":
				valid = v == "true" || v == "false"
				q.EducationInProgress = v == "true"
			case "limit":
				n, err := strconv.Atoi(v)
				valid = err == nil && len(v) <= 2 && strings.Trim(v, "0123456789") == "" && n >= 1 && n <= 50
				q.Limit = n
			case "cursor": // Validated separately after filter errors, with a bounded decoder.
			}
			if !valid {
				failures[key] = "invalid"
				break
			}
		}
	}
	if len(values["language_min_level"]) == 1 && len(values["language"]) == 0 {
		failures["language"] = "required"
	}
	if len(values["education_in_progress"]) == 1 && len(values["education_level"]) == 0 {
		failures["education_level"] = "required"
	}
	for _, selection := range []*[]string{&q.Vacancy, &q.Country, &q.State, &q.Municipality, &q.Seniority, &q.Years, &q.Language} {
		slices.Sort(*selection)
		*selection = slices.Compact(*selection)
	}
	if len(failures) > 0 {
		fields := make([]Field, 0, len(failures))
		for key, code := range failures {
			fields = append(fields, Field{key, code})
		}
		slices.SortFunc(fields, func(a, b Field) int { return strings.Compare(a.Field, b.Field) })
		return Query{}, &InvalidFilter{Fields: fields}
	}
	if token, ok := values["cursor"]; ok {
		position, err := decodeCursor(company, q, token[0])
		if err != nil {
			return Query{}, err
		}
		q.After = &position
	}
	return q, nil
}
func digits(v string, n int) bool { return len(v) == n && strings.Trim(v, "0123456789") == "" }
func filterHash(q Query) string {
	raw, _ := json.Marshal(q.Filters)
	hash := sha256.Sum256(raw)
	return hex.EncodeToString(hash[:])
}

type cursorWire struct {
	Version   int       `json:"version"`
	CompanyID uuid.UUID `json:"company_id"`
	Filters   string    `json:"filters"`
	At        string    `json:"last_activity_at"`
	Kind      string    `json:"kind"`
	ID        uuid.UUID `json:"id"`
}

func encodeCursor(company uuid.UUID, q Query, p Position) (string, error) {
	raw, err := json.Marshal(cursorWire{1, company, filterHash(q), p.At.UTC().Truncate(time.Microsecond).Format(cursorLayout), p.Kind, p.ID})
	if err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(raw), nil
}
func decodeCursor(company uuid.UUID, q Query, token string) (Position, error) {
	if token == "" || len(token) > MaxCursorBytes {
		return Position{}, ErrInvalidCursor
	}
	raw, err := base64.RawURLEncoding.Strict().DecodeString(token)
	if err != nil || base64.RawURLEncoding.EncodeToString(raw) != token {
		return Position{}, ErrInvalidCursor
	}
	var wire cursorWire
	if err := json.Unmarshal(raw, &wire); err != nil {
		return Position{}, ErrInvalidCursor
	}
	// Exact re-encoding rejects duplicate/unknown keys, non-canonical UUIDs,
	// numeric version spellings, trailing JSON and any alternate JSON shape.
	canonical, err := json.Marshal(wire)
	if err != nil || string(canonical) != string(raw) || wire.Version != 1 || wire.CompanyID != company || wire.Filters != filterHash(q) || wire.ID == uuid.Nil || (wire.Kind != "manual" && wire.Kind != "organic") {
		return Position{}, ErrInvalidCursor
	}
	at, err := time.Parse(cursorLayout, wire.At)
	if err != nil || at.Format(cursorLayout) != wire.At {
		return Position{}, ErrInvalidCursor
	}
	return Position{At: at, Kind: wire.Kind, ID: wire.ID}, nil
}
