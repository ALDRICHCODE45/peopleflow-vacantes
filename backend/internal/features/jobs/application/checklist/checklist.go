// Package checklist owns the internal vacancy checklist grammar and the
// recruiter mark input without IO. Contract: docs/contracts/vacancy-checklist-v1.md.
// The backend stores and validates criteria and marks; evaluating criteria
// against candidates belongs to the frontend in v1.
package checklist

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"reflect"
	"slices"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/draftjson"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/drafts"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/pipelineconfig"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/shared/httpjson"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/shared/languages"
	"github.com/google/uuid"
	"golang.org/x/text/cases"
	"golang.org/x/text/unicode/norm"
)

const (
	MaxCriteria       = 50
	LabelMaxLength    = 200
	SkillMaxLength    = 60
	NoteMaxLength     = 500
	MaxStates         = 32
	MaxAcceptedOption = 8
	MaxBodyBytes      = pipelineconfig.MaxBodyBytes
)

const (
	VerdictMet    = "met"
	VerdictNotMet = "not_met"
)

type Field = httpjson.ValidationField

// Invalid carries every field error of one rejected document, in input order.
type Invalid struct{ Fields []Field }

func (e *Invalid) Error() string { return "checklist: validation failed" }

// Criterion params are stored in their canonical encoding for the kind.
type Criterion struct {
	ID         string          `json:"id"`
	Label      string          `json:"label"`
	Importance string          `json:"importance"`
	Kind       string          `json:"kind"`
	Params     json.RawMessage `json:"params"`
}

// Checklist order is display order.
type Checklist struct {
	Criteria         []Criterion `json:"criteria"`
	ReminderStageIDs []string    `json:"reminder_stage_ids"`
}

// Question is one single-choice screening question of the vacancy. Open
// questions are never offered: they have no options to accept.
type Question struct {
	ID      string
	Options []string
}

// Geo answers catalog membership; errors are infrastructure failures.
type Geo interface {
	CountryExists(code string) (bool, error)
	StateExists(country, state string) (bool, error)
}

// Rules is the vacancy state a PUT is validated against.
type Rules struct {
	Questions []Question
	Stages    []string
	Geo       Geo
}

// Empty is the never-saved checklist. It encodes arrays, never null.
func Empty() Checklist { return Checklist{Criteria: []Criterion{}, ReminderStageIDs: []string{}} }

// ETag is strong and opaque, domain-separated from draft and pipeline tags.
// Version zero is the never-saved checklist.
func ETag(id uuid.UUID, version int64) string {
	digest := sha256.Sum256([]byte("job-draft-checklist:r1:" + id.String() + ":" + strconv.FormatInt(version, 10)))
	return `"vc1-` + base64.RawURLEncoding.EncodeToString(digest[:]) + `"`
}

// Equal ignores object-key order (JSONB may reorder params), but retains array
// order: criteria and reminder stages remain ordered replacement documents.
func (c Checklist) Equal(other Checklist) bool {
	a, errA := json.Marshal(c)
	b, errB := json.Marshal(other)
	if errA != nil || errB != nil {
		return false
	}
	var left, right any
	if json.Unmarshal(a, &left) != nil || json.Unmarshal(b, &right) != nil {
		return false
	}
	return reflect.DeepEqual(left, right)
}

// Has reports whether criterionID (canonical) is a current criterion.
func (c Checklist) Has(criterionID string) bool {
	for _, criterion := range c.Criteria {
		if criterion.ID == criterionID {
			return true
		}
	}
	return false
}

// Visible drops reminder stages that are no longer pipeline stages, so a GET
// followed by a PUT of the same document never fails on a retired stage.
func (c Checklist) Visible(stages []string) Checklist {
	current := map[string]bool{}
	for _, s := range stages {
		current[strings.ToLower(s)] = true
	}
	out := Checklist{Criteria: c.Criteria, ReminderStageIDs: []string{}}
	for _, id := range c.ReminderStageIDs {
		if current[strings.ToLower(id)] {
			out.ReminderStageIDs = append(out.ReminderStageIDs, id)
		}
	}
	return out
}

// Decode reads a stored checklist. Stored rows were validated on write.
func Decode(raw []byte) (Checklist, error) {
	var c Checklist
	if err := json.Unmarshal(raw, &c); err != nil {
		return Checklist{}, fmt.Errorf("decode stored checklist: %w", err)
	}
	if c.Criteria == nil || c.ReminderStageIDs == nil {
		return Checklist{}, fmt.Errorf("decode stored checklist: missing arrays")
	}
	return c, nil
}

type validator struct {
	rules  Rules
	fields []Field
	err    error
}

func (v *validator) add(field, code string) {
	v.fields = append(v.fields, Field{Field: field, Code: code})
}

// Replace strictly decodes a full PUT document and validates it against the
// vacancy. Failures return *Invalid, drafts.ErrInvalidRequest,
// drafts.ErrPayloadTooLarge or an infrastructure error, never a partial value.
func Replace(body []byte, rules Rules) (Checklist, error) {
	if len(body) > MaxBodyBytes {
		return Checklist{}, drafts.ErrPayloadTooLarge
	}
	value, err := draftjson.Decode(body)
	if err != nil {
		return Checklist{}, drafts.ErrInvalidRequest
	}
	root, ok := value.(map[string]any)
	if !ok {
		return Checklist{}, drafts.ErrInvalidRequest
	}
	v := &validator{rules: rules}
	for _, key := range sortedKeys(root) {
		if key != "criteria" && key != "reminder_stage_ids" {
			v.add(key, "not_allowed")
		}
	}
	out := Empty()
	if raw, present := root["criteria"]; !present {
		v.add("criteria", "required")
	} else if items, ok := raw.([]any); !ok {
		v.add("criteria", "invalid")
	} else if len(items) > MaxCriteria {
		v.add("criteria", "too_long")
	} else {
		out.Criteria = v.criteria(items)
	}
	out.ReminderStageIDs = v.stages(root)
	if v.err != nil {
		return Checklist{}, v.err
	}
	if len(v.fields) > 0 {
		return Checklist{}, &Invalid{Fields: v.fields}
	}
	return out, nil
}

func (v *validator) stages(root map[string]any) []string {
	raw, present := root["reminder_stage_ids"]
	if !present {
		v.add("reminder_stage_ids", "required")
		return nil
	}
	items, ok := raw.([]any)
	if !ok {
		v.add("reminder_stage_ids", "invalid")
		return nil
	}
	known := map[string]string{}
	for _, s := range v.rules.Stages {
		known[strings.ToLower(s)] = s
	}
	out, seen := []string{}, map[string]bool{}
	for i, item := range items {
		field := fmt.Sprintf("reminder_stage_ids[%d]", i)
		text, _ := item.(string)
		stage, ok := known[strings.ToLower(text)]
		switch {
		case !ok:
			v.add(field, "invalid")
		case seen[stage]:
			v.add(field, "duplicate")
		default:
			seen[stage] = true
			out = append(out, stage)
		}
	}
	return out
}

type uniqueness struct {
	ids, languages, skills, questions map[string]bool
	location                          bool
}

func (v *validator) criteria(items []any) []Criterion {
	seen := uniqueness{ids: map[string]bool{}, languages: map[string]bool{}, skills: map[string]bool{}, questions: map[string]bool{}}
	out := make([]Criterion, 0, len(items))
	for i, item := range items {
		if c, ok := v.criterion(fmt.Sprintf("criteria[%d]", i), item, &seen); ok {
			out = append(out, c)
		}
	}
	return out
}

var criterionKeys = map[string]bool{"id": true, "label": true, "importance": true, "kind": true, "params": true}

func (v *validator) criterion(path string, raw any, seen *uniqueness) (Criterion, bool) {
	object, ok := raw.(map[string]any)
	if !ok {
		v.add(path, "invalid")
		return Criterion{}, false
	}
	before := len(v.fields)
	for _, key := range sortedKeys(object) {
		if !criterionKeys[key] {
			v.add(path+"."+key, "not_allowed")
		}
	}
	var c Criterion
	if id, ok := v.uuidField(object, "id", path+".id"); ok {
		if seen.ids[id] {
			v.add(path+".id", "duplicate")
		}
		seen.ids[id] = true
		c.ID = id
	}
	if label, ok := v.text(object, "label", path+".label", LabelMaxLength); ok {
		c.Label = label
	}
	switch importance := object["importance"]; {
	case importance == nil:
		v.add(path+".importance", "required")
	case importance == "required" || importance == "desirable":
		c.Importance = importance.(string)
	default:
		v.add(path+".importance", "invalid")
	}
	kind, _ := object["kind"].(string)
	decode, known := kinds[kind]
	switch {
	case object["kind"] == nil:
		v.add(path+".kind", "required")
	case !known:
		v.add(path+".kind", "invalid")
	case kind == "location" && seen.location:
		v.add(path+".kind", "duplicate")
	}
	if kind == "location" {
		seen.location = true
	}
	c.Kind = kind
	params, present := object["params"]
	paramsObject, isObject := params.(map[string]any)
	switch {
	case !present:
		v.add(path+".params", "required")
	case !isObject:
		v.add(path+".params", "invalid")
	case known:
		if encoded := decode(v, path+".params", paramsObject, seen); encoded != nil {
			c.Params = encoded
		}
	}
	return c, len(v.fields) == before
}

type kindDecoder func(v *validator, path string, params map[string]any, seen *uniqueness) json.RawMessage

var kinds = map[string]kindDecoder{
	"min_years_experience": decodeYears,
	"seniority":            decodeSeniority,
	"education":            decodeEducation,
	"language":             decodeLanguage,
	"skill":                decodeSkill,
	"location":             decodeLocation,
	"screening_answer":     decodeScreening,
	"manual":               decodeManual,
}

// only reports keys outside allowed; the caller still validates each one.
func (v *validator) only(path string, params map[string]any, allowed ...string) {
	for _, key := range sortedKeys(params) {
		if !slices.Contains(allowed, key) {
			v.add(path+"."+key, "not_allowed")
		}
	}
}

func encode(value any) json.RawMessage {
	encoded, _ := json.Marshal(value)
	return encoded
}

func decodeYears(v *validator, path string, params map[string]any, _ *uniqueness) json.RawMessage {
	v.only(path, params, "min")
	raw, present := params["min"]
	if !present {
		v.add(path+".min", "required")
		return nil
	}
	text, _ := raw.(string)
	years, ok := languages.NormalizeYears(text)
	if !ok {
		v.add(path+".min", "invalid")
		return nil
	}
	return encode(struct {
		Min string `json:"min"`
	}{years})
}

func decodeSeniority(v *validator, path string, params map[string]any, _ *uniqueness) json.RawMessage {
	v.only(path, params, "accepted")
	accepted, ok := v.enumList(params, "accepted", path+".accepted", len(languages.Seniorities()), languages.ValidSeniority)
	if !ok {
		return nil
	}
	return encode(struct {
		Accepted []string `json:"accepted"`
	}{accepted})
}

func decodeEducation(v *validator, path string, params map[string]any, _ *uniqueness) json.RawMessage {
	v.only(path, params, "min_level", "accepts_in_progress")
	level, levelOK := v.enum(params, "min_level", path+".min_level", languages.ValidEducationLevel)
	flag, present := params["accepts_in_progress"]
	inProgress, flagOK := flag.(bool)
	if !present {
		v.add(path+".accepts_in_progress", "required")
	} else if !flagOK {
		v.add(path+".accepts_in_progress", "invalid")
	}
	if !levelOK || !flagOK {
		return nil
	}
	return encode(struct {
		MinLevel          string `json:"min_level"`
		AcceptsInProgress bool   `json:"accepts_in_progress"`
	}{level, inProgress})
}

func decodeLanguage(v *validator, path string, params map[string]any, seen *uniqueness) json.RawMessage {
	v.only(path, params, languages.CodeField, "min_level")
	code, codeOK := v.enum(params, languages.CodeField, path+"."+languages.CodeField, func(code string) bool {
		_, ok := languages.Lookup(code)
		return ok
	})
	if codeOK && seen.languages[code] {
		v.add(path+".code", "duplicate")
		codeOK = false
	}
	if codeOK {
		seen.languages[code] = true
	}
	level, levelOK := v.enum(params, "min_level", path+".min_level", languages.ValidLanguageLevel)
	if !codeOK || !levelOK {
		return nil
	}
	// Keys sort as code < min_level, the documented order.
	return encode(map[string]string{languages.CodeField: code, "min_level": level})
}

func decodeSkill(v *validator, path string, params map[string]any, seen *uniqueness) json.RawMessage {
	v.only(path, params, "name")
	name, ok := v.text(params, "name", path+".name", SkillMaxLength)
	if !ok {
		return nil
	}
	key := SkillKey(name)
	if seen.skills[key] {
		v.add(path+".name", "duplicate")
		return nil
	}
	seen.skills[key] = true
	return encode(struct {
		Name string `json:"name"`
	}{name})
}

func decodeLocation(v *validator, path string, params map[string]any, _ *uniqueness) json.RawMessage {
	v.only(path, params, "country", "states")
	country, countryOK := v.enum(params, "country", path+".country", func(code string) bool {
		exists, err := v.rules.Geo.CountryExists(code)
		v.fail(err)
		return exists
	})
	raw, present := params["states"]
	items, listOK := raw.([]any)
	switch {
	case !present:
		v.add(path+".states", "required")
		return nil
	case !listOK:
		v.add(path+".states", "invalid")
		return nil
	case len(items) > MaxStates:
		v.add(path+".states", "too_long")
		return nil
	}
	states, seen, ok := []string{}, map[string]bool{}, countryOK
	for i, item := range items {
		field := fmt.Sprintf("%s.states[%d]", path, i)
		state, isText := item.(string)
		if !isText || !countryOK {
			if !isText {
				v.add(field, "invalid")
				ok = false
			}
			continue
		}
		exists, err := v.rules.Geo.StateExists(country, state)
		v.fail(err)
		switch {
		case !exists:
			v.add(field, "invalid")
			ok = false
		case seen[state]:
			v.add(field, "duplicate")
			ok = false
		default:
			seen[state] = true
			states = append(states, state)
		}
	}
	if !ok {
		return nil
	}
	return encode(struct {
		Country string   `json:"country"`
		States  []string `json:"states"`
	}{country, states})
}

func decodeScreening(v *validator, path string, params map[string]any, seen *uniqueness) json.RawMessage {
	v.only(path, params, "question_id", "accepted_option_ids")
	var question *Question
	text, isText := params["question_id"].(string)
	switch {
	case params["question_id"] == nil:
		v.add(path+".question_id", "required")
	case !isText:
		v.add(path+".question_id", "invalid")
	default:
		for i := range v.rules.Questions {
			if strings.EqualFold(v.rules.Questions[i].ID, text) {
				question = &v.rules.Questions[i]
				break
			}
		}
		switch {
		case question == nil:
			v.add(path+".question_id", "invalid")
		case seen.questions[strings.ToLower(question.ID)]:
			v.add(path+".question_id", "duplicate")
			question = nil
		default:
			seen.questions[strings.ToLower(question.ID)] = true
		}
	}
	options := []string{}
	if question != nil {
		options = question.Options
	}
	accepted, ok := v.enumList(params, "accepted_option_ids", path+".accepted_option_ids", MaxAcceptedOption, func(id string) bool {
		return question == nil || canonicalOption(options, id) != ""
	})
	if !ok || question == nil {
		return nil
	}
	for i, id := range accepted {
		accepted[i] = canonicalOption(options, id)
	}
	return encode(struct {
		QuestionID        string   `json:"question_id"`
		AcceptedOptionIDs []string `json:"accepted_option_ids"`
	}{question.ID, accepted})
}

func canonicalOption(options []string, id string) string {
	for _, option := range options {
		if strings.EqualFold(option, id) {
			return option
		}
	}
	return ""
}

func decodeManual(v *validator, path string, params map[string]any, _ *uniqueness) json.RawMessage {
	v.only(path, params)
	return json.RawMessage(`{}`)
}

func (v *validator) fail(err error) {
	if err != nil && v.err == nil {
		v.err = err
	}
}

func (v *validator) uuidField(object map[string]any, key, field string) (string, bool) {
	raw, present := object[key]
	if !present {
		v.add(field, "required")
		return "", false
	}
	text, _ := raw.(string)
	id, err := uuid.Parse(text)
	if err != nil || id == uuid.Nil || len(text) != 36 {
		v.add(field, "invalid")
		return "", false
	}
	return id.String(), true
}

// text trims after NFC composition and measures code points.
func (v *validator) text(object map[string]any, key, field string, limit int) (string, bool) {
	raw, present := object[key]
	if !present {
		v.add(field, "required")
		return "", false
	}
	text, ok := raw.(string)
	if !ok || !utf8.ValidString(text) {
		v.add(field, "invalid")
		return "", false
	}
	text = strings.TrimSpace(norm.NFC.String(text))
	switch {
	case text == "":
		v.add(field, "required")
		return "", false
	case utf8.RuneCountInString(text) > limit:
		v.add(field, "too_long")
		return "", false
	case strings.IndexFunc(text, unicode.IsControl) >= 0:
		v.add(field, "invalid")
		return "", false
	}
	return text, true
}

func (v *validator) enum(object map[string]any, key, field string, valid func(string) bool) (string, bool) {
	raw, present := object[key]
	if !present {
		v.add(field, "required")
		return "", false
	}
	text, ok := raw.(string)
	if !ok || !valid(text) {
		v.add(field, "invalid")
		return "", false
	}
	return text, true
}

// enumList requires 1..limit unique valid strings.
func (v *validator) enumList(object map[string]any, key, field string, limit int, valid func(string) bool) ([]string, bool) {
	raw, present := object[key]
	items, isList := raw.([]any)
	switch {
	case !present:
		v.add(field, "required")
		return nil, false
	case !isList:
		v.add(field, "invalid")
		return nil, false
	case len(items) == 0:
		v.add(field, "required")
		return nil, false
	case len(items) > limit:
		v.add(field, "too_long")
		return nil, false
	}
	out, seen, ok := make([]string, 0, len(items)), map[string]bool{}, true
	for i, item := range items {
		path := fmt.Sprintf("%s[%d]", field, i)
		text, isText := item.(string)
		switch {
		case !isText || !valid(text):
			v.add(path, "invalid")
			ok = false
		case seen[strings.ToLower(text)]:
			v.add(path, "duplicate")
			ok = false
		default:
			seen[strings.ToLower(text)] = true
			out = append(out, text)
		}
	}
	return out, ok
}

// SkillKey compares skills case- and accent-insensitively, as the contract's
// evaluation rule does: decompose, drop combining marks, fold case.
func SkillKey(name string) string {
	var b strings.Builder
	for _, r := range norm.NFD.String(strings.TrimSpace(name)) {
		if !unicode.Is(unicode.Mn, r) {
			b.WriteRune(r)
		}
	}
	return norm.NFC.String(cases.Fold().String(b.String()))
}

// MarkInput is the body of PUT …/checklist-marks/{criterion_id}.
type MarkInput struct {
	Verdict string
	Note    *string
}

// DecodeMark validates a mark write. A blank note is stored as null.
func DecodeMark(body []byte) (MarkInput, error) {
	value, err := draftjson.Decode(body)
	if err != nil {
		return MarkInput{}, drafts.ErrInvalidRequest
	}
	object, ok := value.(map[string]any)
	if !ok {
		return MarkInput{}, drafts.ErrInvalidRequest
	}
	v := &validator{}
	v.only("", object, "verdict", "note")
	for i := range v.fields {
		v.fields[i].Field = strings.TrimPrefix(v.fields[i].Field, ".")
	}
	var out MarkInput
	switch verdict := object["verdict"]; {
	case verdict == nil:
		v.add("verdict", "required")
	case verdict == VerdictMet || verdict == VerdictNotMet:
		out.Verdict = verdict.(string)
	default:
		v.add("verdict", "invalid")
	}
	if raw, present := object["note"]; present && raw != nil {
		note, isText := raw.(string)
		note = strings.TrimSpace(norm.NFC.String(note))
		switch {
		case !isText || !utf8.ValidString(note):
			v.add("note", "invalid")
		case utf8.RuneCountInString(note) > NoteMaxLength:
			v.add("note", "too_long")
		case note != "":
			out.Note = &note
		}
	}
	if len(v.fields) > 0 {
		return MarkInput{}, &Invalid{Fields: v.fields}
	}
	return out, nil
}

func sortedKeys(object map[string]any) []string {
	keys := make([]string, 0, len(object))
	for key := range object {
		keys = append(keys, key)
	}
	slices.Sort(keys)
	return keys
}
