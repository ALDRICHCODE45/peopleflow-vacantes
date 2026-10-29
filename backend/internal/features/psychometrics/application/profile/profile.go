// Package profile validates full replacement employer psychometric profiles.
package profile

import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"reflect"
	"slices"
	"sort"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/psychometrics/content"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/shared/httpjson"
	"github.com/google/uuid"
)

const MaxBodyBytes = 256 << 10

var ErrInvalidRequest = errors.New("invalid profile request")

type Competency struct {
	CompetencyID string  `json:"competency_id"`
	Importance   string  `json:"importance"`
	DesiredBand  *string `json:"desired_band"`
	Rationale    *string `json:"rationale"`
	Task         *string `json:"task"`
}
type Profile struct {
	Enabled          bool         `json:"enabled"`
	Test             string       `json:"test"`
	Confirmed        bool         `json:"confirmed"`
	ConfirmedAt      *string      `json:"confirmed_at"`
	Competencies     []Competency `json:"competencies"`
	AutoSendStageIDs []string     `json:"auto_send_stage_ids"`
	ExpiresInDays    int          `json:"expires_in_days"`
}
type Invalid struct{ Fields []httpjson.ValidationField }

func (*Invalid) Error() string { return "validation failed" }
func catalog() content.Document {
	a, err := content.Load(content.Version)
	if err != nil {
		panic(err)
	}
	return a.Snapshot()
}
func Empty() Profile {
	d := catalog()
	p := Profile{Test: d.Test, ExpiresInDays: 7, Competencies: []Competency{}, AutoSendStageIDs: []string{}}
	for _, c := range d.Competencies {
		p.Competencies = append(p.Competencies, Competency{CompetencyID: c.ID, Importance: "importance.no_relevante"})
	}
	return p
}
func ETag(id uuid.UUID, version int64) string {
	sum := sha256.Sum256([]byte("job-psychometric-profile:r1:" + id.String() + ":" + strconv.FormatInt(version, 10)))
	return `"pp1-` + base64.RawURLEncoding.EncodeToString(sum[:]) + `"`
}
func (p Profile) Equal(other Profile) bool { return reflect.DeepEqual(p, other) }
func (p Profile) RequirementsEqual(other Profile) bool {
	return reflect.DeepEqual(p.Competencies, other.Competencies)
}
func (p Profile) Visible(stages []string) Profile {
	p.AutoSendStageIDs = slices.DeleteFunc(slices.Clone(p.AutoSendStageIDs), func(s string) bool { return !slices.Contains(stages, s) })
	return p
}

// Decode exactly one JSON value, rejecting duplicate object keys at any depth.
func value(d *json.Decoder) (any, error) {
	t, err := d.Token()
	if err != nil {
		return nil, err
	}
	delim, ok := t.(json.Delim)
	if !ok {
		return t, nil
	}
	switch delim {
	case '{':
		m := map[string]any{}
		for d.More() {
			k, err := d.Token()
			if err != nil {
				return nil, err
			}
			key, ok := k.(string)
			if !ok {
				return nil, ErrInvalidRequest
			}
			if _, exists := m[key]; exists {
				return nil, ErrInvalidRequest
			}
			v, err := value(d)
			if err != nil {
				return nil, err
			}
			m[key] = v
		}
		_, err = d.Token()
		return m, err
	case '[':
		a := []any{}
		for d.More() {
			v, err := value(d)
			if err != nil {
				return nil, err
			}
			a = append(a, v)
		}
		_, err = d.Token()
		return a, err
	default:
		return nil, ErrInvalidRequest
	}
}
func Replace(raw []byte, stages []string) (Profile, error) {
	if len(raw) > MaxBodyBytes || !utf8.Valid(raw) {
		return Profile{}, ErrInvalidRequest
	}
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.UseNumber()
	v, err := value(dec)
	if err != nil {
		return Profile{}, ErrInvalidRequest
	}
	if _, err = dec.Token(); err != io.EOF {
		return Profile{}, ErrInvalidRequest
	}
	m, ok := v.(map[string]any)
	if !ok {
		return Profile{}, ErrInvalidRequest
	}
	fs := []httpjson.ValidationField{}
	add := func(f, c string) { fs = append(fs, httpjson.ValidationField{Field: f, Code: c}) }
	only := func(m map[string]any, prefix string, keys ...string) {
		unknown := []string{}
		for k := range m {
			if !slices.Contains(keys, k) {
				unknown = append(unknown, k)
			}
		}
		sort.Strings(unknown)
		for _, k := range unknown {
			add(prefix+k, "not_allowed")
		}
		for _, k := range keys {
			if _, ok := m[k]; !ok {
				add(prefix+k, "required")
			}
		}
	}
	only(m, "", "enabled", "test", "confirmed", "competencies", "auto_send_stage_ids", "expires_in_days")
	p := Empty()
	for k, dst := range map[string]*bool{"enabled": &p.Enabled, "confirmed": &p.Confirmed} {
		if x, exists := m[k]; exists {
			b, ok := x.(bool)
			if !ok {
				add(k, "invalid")
			} else {
				*dst = b
			}
		}
	}
	if x, ok := m["test"]; ok && x != p.Test {
		add("test", "invalid")
	}
	if x, ok := m["expires_in_days"]; ok {
		n, ok := x.(json.Number)
		i, e := strconv.Atoi(string(n))
		if !ok || e != nil || i < 1 || i > 30 {
			add("expires_in_days", "invalid")
		} else {
			p.ExpiresInDays = i
		}
	}
	d := catalog()
	ids := []string{}
	bands := []string{}
	for _, c := range d.Competencies {
		ids = append(ids, c.ID)
	}
	for _, b := range d.Bands {
		bands = append(bands, b.ID)
	}
	if x, exists := m["competencies"]; exists {
		cs, ok := x.([]any)
		if !ok {
			add("competencies", "invalid")
		} else {
			if len(cs) < len(ids) {
				add("competencies", "required")
			}
			if len(cs) > len(ids) {
				add("competencies", "invalid")
			}
			p.Competencies = []Competency{}
			seen := map[string]bool{}
			for i, x := range cs {
				path := fmt.Sprintf("competencies[%d].", i)
				c, ok := x.(map[string]any)
				if !ok {
					add(strings.TrimSuffix(path, "."), "invalid")
					continue
				}
				only(c, path, "competency_id", "importance", "desired_band", "rationale", "task")
				out := Competency{}
				id, _ := c["competency_id"].(string)
				out.CompetencyID = id
				if _, exists := c["competency_id"]; exists {
					if !slices.Contains(ids, id) {
						add(path+"competency_id", "invalid")
					} else if seen[id] {
						add(path+"competency_id", "duplicate")
					}
					seen[id] = true
				}
				importance, _ := c["importance"].(string)
				out.Importance = importance
				if _, exists := c["importance"]; exists && !slices.Contains([]string{"importance.clave", "importance.importante", "importance.no_relevante"}, importance) {
					add(path+"importance", "invalid")
				}
				if band, exists := c["desired_band"]; exists {
					if importance == "importance.no_relevante" {
						if band != nil {
							add(path+"desired_band", "not_allowed")
						}
					} else if importance == "importance.clave" || importance == "importance.importante" {
						if band == nil {
							add(path+"desired_band", "required")
						} else {
							b, ok := band.(string)
							if !ok || !slices.Contains(bands, b) {
								add(path+"desired_band", "invalid")
							} else {
								out.DesiredBand = &b
							}
						}
					}
				}
				for _, key := range []string{"rationale", "task"} {
					x, exists := c[key]
					if !exists {
						continue
					}
					forbidden := importance == "importance.no_relevante" || (key == "task" && importance == "importance.importante")
					if forbidden {
						if x != nil {
							add(path+key, "not_allowed")
						}
						continue
					}
					relevant := importance == "importance.clave" || importance == "importance.importante"
					required := p.Confirmed && relevant && (key == "rationale" || importance == "importance.clave")
					// Drafts accept null and empty text as empty, preserving their wire shape.
					if x == nil {
						if required {
							add(path+key, "required")
						}
						continue
					}
					s, ok := x.(string)
					if !ok {
						add(path+key, "invalid")
						continue
					}
					s = strings.TrimSpace(s)
					max := 1000
					if key == "task" {
						max = 300
					}
					if utf8.RuneCountInString(s) > max {
						add(path+key, "too_long")
					} else if s == "" && required {
						add(path+key, "required")
					}
					if key == "rationale" {
						out.Rationale = &s
					} else {
						out.Task = &s
					}
				}
				p.Competencies = append(p.Competencies, out)
			}
		}
	}
	if x, exists := m["auto_send_stage_ids"]; exists {
		a, ok := x.([]any)
		if !ok {
			add("auto_send_stage_ids", "invalid")
		} else {
			seen := map[string]bool{}
			p.AutoSendStageIDs = []string{}
			for i, x := range a {
				path := fmt.Sprintf("auto_send_stage_ids[%d]", i)
				s, ok := x.(string)
				if !ok || !slices.Contains(stages, s) {
					add(path, "invalid")
				} else if seen[s] {
					add(path, "duplicate")
				}
				seen[s] = true
				p.AutoSendStageIDs = append(p.AutoSendStageIDs, s)
			}
		}
	}
	if len(fs) > 0 {
		return Profile{}, &Invalid{Fields: fs}
	}
	return p, nil
}
