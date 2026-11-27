package email

import (
	"bytes"
	"embed"
	"errors"
	htmltemplate "html/template"
	"net/mail"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	texttemplate "text/template"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/notifications/domain"
	"github.com/google/uuid"
)

// TokenSigner issues the unsubscribe token of one (user, company, type)
// (§Unsubscribe, D16); the HMAC implementation ships in E7. It is called only
// for non-mandatory types. Tokens must match [A-Za-z0-9_.-]{1,512}.
type TokenSigner interface {
	Sign(key domain.PreferenceKey) (string, error)
}

// View is everything the renderer needs about one delivery, resolved by the
// sender at send time (E6): the address read from users.email (never stored,
// D19), the group's count and link descriptor, and the §Content variables as
// code values (labels are mapped here). Nothing else reaches the email.
type View struct {
	DeliveryID uuid.UUID
	Type       domain.Type
	To         string
	User       uuid.UUID
	// Company is the member's company; uuid.Nil for candidate types (D1).
	Company uuid.UUID
	// Count is the number of notifications linked to the delivery (≥ 1).
	Count int
	// Link is the group's descriptor (inbox rule); nil only for
	// vacancy_unassigned (→ /empresa) and candidate types (→ /candidato/postulaciones).
	Link *Link
	// JobTitle / CompanyName: nil or blank → «una vacante» / «una empresa».
	JobTitle, CompanyName *string
	// Day is an instant of the group (T1, T2), shown as its Mexico City day.
	Day time.Time
	// CommitmentDate is a DATE value (T7–T10), shown from its own components.
	CommitmentDate time.Time
	// Function, Reason, Status are code values of the §Labels maps.
	Function, Reason, Status string
}

// Settings are the renderer's configuration (§Config keys).
type Settings struct {
	// From is the sender in header form; its domain names the Message-ID.
	From string
	// AppBaseURL is the frontend origin of every link.
	AppBaseURL string
	// UnsubscribeURL is the RFC 8058 one-click URL (?token= is appended).
	UnsubscribeURL string
	// PostalAddress is the legal line's address
	// (NOTIFICATIONS_EMAIL_POSTAL_ADDRESS); empty → DefaultPostalAddress.
	PostalAddress string
}

// Renderer turns a View into a Message with the §Templates copy.
type Renderer struct {
	from, domain, base, unsubscribe string
	legal                           string
	signer                          TokenSigner
}

//go:embed templates/layout.txt.tmpl templates/layout.html.tmpl
var layoutFS embed.FS

var (
	textLayout = texttemplate.Must(texttemplate.New("layout.txt.tmpl").Option("missingkey=error").ParseFS(layoutFS, "templates/layout.txt.tmpl"))
	htmlLayout = htmltemplate.Must(htmltemplate.New("layout.html.tmpl").Option("missingkey=error").
			Funcs(htmltemplate.FuncMap{"mso": mso}).ParseFS(layoutFS, "templates/layout.html.tmpl"))
)

var tokenPattern = regexp.MustCompile(`^[A-Za-z0-9_.-]{1,512}$`)

// NewRenderer validates the settings; the signer is required (E7 supplies
// the HMAC one, tests a fake).
func NewRenderer(s Settings, signer TokenSigner) (*Renderer, error) {
	if signer == nil {
		return nil, errors.New("email: token signer required")
	}
	addr, err := mail.ParseAddress(s.From)
	if err != nil {
		return nil, errors.New("email: invalid sender")
	}
	at := strings.LastIndexByte(addr.Address, '@')
	if at <= 0 || at == len(addr.Address)-1 {
		return nil, errors.New("email: invalid sender")
	}
	base, err := absoluteHTTP(s.AppBaseURL)
	if err != nil {
		return nil, errors.New("email: invalid app base URL")
	}
	unsubscribe, err := absoluteHTTP(s.UnsubscribeURL)
	if err != nil {
		return nil, errors.New("email: invalid unsubscribe URL")
	}
	postal := strings.TrimSpace(s.PostalAddress)
	if postal == "" {
		postal = DefaultPostalAddress
	}
	if strings.IndexFunc(postal, unicode.IsControl) >= 0 || utf8.RuneCountInString(postal) > maxPostalAddressRunes {
		return nil, errors.New("email: invalid postal address")
	}
	return &Renderer{from: s.From, domain: addr.Address[at+1:], base: base, unsubscribe: unsubscribe,
		legal: "PeopleFlow · " + postal, signer: signer}, nil
}

func absoluteHTTP(v string) (string, error) {
	u, err := url.Parse(v)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" || u.RawQuery != "" || u.Fragment != "" || u.User != nil {
		return "", errors.New("invalid")
	}
	return strings.TrimRight(v, "/"), nil
}

// layoutData feeds both layouts; html/template escapes every field in the
// HTML part (contextually, URLs included), the text part is literal. Body
// and VMLButton are the only pre-built HTML: their data values are escaped
// in Go (richBody, vmlButton). The design fields (03 · Centrada) are used by
// the HTML part only; Tone holds constants of the tones table.
type layoutData struct {
	Subject, Heading, Line, Button, AppURL string
	FooterLine                             string
	PreferencesLabel, PreferencesURL       string
	UnsubscribeLabel, UnsubscribeURL       string

	Body                  htmltemplate.HTML
	VMLButton             htmltemplate.HTML
	HomeURL               string
	Tone                  tone
	Glyph                 string
	GlyphSize             int
	Eyebrow, Urgency      string
	Mandatory             bool
	MandatoryLabel, Legal string
}

// Render builds the Message of a delivery: template by type and group form,
// verbatim copy with labels/fallbacks, Mexico City dates, the deep link of the
// path map, footer F1/F2, and the headers (List-Unsubscribe only for
// non-mandatory types, D15). Any inconsistency is an error, never a guess.
func (r *Renderer) Render(v View) (Message, error) {
	spec, ok := domain.Lookup(v.Type)
	if !ok {
		return Message{}, errors.New("email: unknown notification type")
	}
	if v.DeliveryID == uuid.Nil || v.User == uuid.Nil {
		return Message{}, errors.New("email: delivery and user ids required")
	}
	if strings.TrimSpace(v.To) == "" {
		return Message{}, errors.New("email: recipient address required")
	}
	if v.Count < 1 {
		return Message{}, errors.New("email: count must be at least 1")
	}
	member := spec.RecipientKind == domain.RecipientMember
	if member != (v.Company != uuid.Nil) {
		return Message{}, errors.New("email: company does not match the recipient kind")
	}

	f, path, err := resolveLink(spec, v)
	if err != nil {
		return Message{}, err
	}
	cc, ok := compiledSpecs[specKey{v.Type, f}]
	if !ok {
		return Message{}, errors.New("email: no template for the type and form")
	}
	vars := map[string]string{
		"job_title":    orFallback(v.JobTitle, fallbackJobTitle),
		"company_name": orFallback(v.CompanyName, fallbackCompanyName),
	}
	for _, name := range cc.spec.vars {
		value, err := variable(name, v)
		if err != nil {
			return Message{}, err
		}
		vars[name] = value
	}
	var data layoutData
	for _, field := range []struct {
		t   *texttemplate.Template
		out *string
	}{{cc.subject, &data.Subject}, {cc.heading, &data.Heading}, {cc.line, &data.Line}, {cc.button, &data.Button}} {
		var b strings.Builder
		if err := field.t.Execute(&b, vars); err != nil {
			return Message{}, errors.New("email: copy references an unknown variable")
		}
		*field.out = b.String()
	}

	// Design: tone, seal, eyebrow, urgency, «Obligatorio», emphasized body.
	cs, ok := compiledStyles[cc.spec.id]
	if !ok {
		return Message{}, errors.New("email: no style for the template")
	}
	var body strings.Builder
	if err := cs.body.Execute(&body, vars); err != nil {
		return Message{}, errors.New("email: body references an unknown variable")
	}
	if stripSentinels.Replace(body.String()) != data.Line {
		return Message{}, errors.New("email: body markup differs from the copy line")
	}
	data.Body = richBody(body.String(), cs.tone)
	data.Tone = cs.tone
	data.Eyebrow, data.Urgency = cs.style.eyebrow, cs.style.urgency
	hasCompany := orFallback(v.CompanyName, "") != ""
	if cs.style.eyebrow == "" && hasCompany {
		data.Eyebrow = vars["company_name"]
	}
	data.Glyph = sealGlyph(cs.style, v.Count, vars["company_name"], hasCompany)
	data.GlyphSize = glyphFontSize(data.Glyph)
	data.Mandatory = domain.Locked(v.Type)
	data.MandatoryLabel = labelMandatory
	data.HomeURL = r.base
	data.Legal = r.legal

	data.AppURL = r.base + path
	data.VMLButton = vmlButton(data.AppURL, data.Button)
	data.PreferencesLabel = labelPreferences
	data.PreferencesURL = r.base + PathCandidatePreferences
	if member {
		data.PreferencesURL = r.base + PathMemberPreferences
	}
	headers := map[string]string{"Auto-Submitted": "auto-generated"}
	if domain.Locked(v.Type) {
		data.FooterLine = footerMandatory
	} else {
		token, err := r.signer.Sign(domain.PreferenceKey{User: v.User, Company: v.Company, Type: v.Type})
		if err != nil {
			return Message{}, errors.New("email: unsubscribe token unavailable")
		}
		if !tokenPattern.MatchString(token) {
			return Message{}, errors.New("email: unsubscribe token has an invalid shape")
		}
		q := "?token=" + url.QueryEscape(token)
		data.FooterLine = footerOptional
		data.UnsubscribeLabel = labelUnsubscribeByType
		data.UnsubscribeURL = r.base + PathUnsubscribeLanding + q
		headers["List-Unsubscribe"] = "<" + r.unsubscribe + q + ">"
		headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click"
	}

	var text, html bytes.Buffer
	if err := textLayout.Execute(&text, data); err != nil {
		return Message{}, errors.New("email: text layout failed")
	}
	if err := htmlLayout.Execute(&html, data); err != nil {
		return Message{}, errors.New("email: html layout failed")
	}
	return Message{
		To:         v.To,
		From:       r.from,
		Subject:    data.Subject,
		Text:       text.String(),
		HTML:       html.String(),
		MessageID:  "<" + v.DeliveryID.String() + "@" + r.domain + ">",
		Headers:    headers,
		DeliveryID: v.DeliveryID.String(),
		Type:       string(v.Type),
		Template:   cc.spec.id,
	}, nil
}

// linkRule is the link kinds a type accepts and the path of a null link
// ("" = a link is required).
type linkRule struct {
	kinds    []LinkKind
	nullPath string
}

var linkRules = map[domain.Type]linkRule{
	domain.TypeApplicationReceived:       {kinds: []LinkKind{LinkParticipation, LinkVacancyCandidates}},
	domain.TypePsychometricCompleted:     {kinds: []LinkKind{LinkParticipation, LinkVacancyCandidates}},
	domain.TypePsychometricPending:       {kinds: []LinkKind{LinkParticipation, LinkVacancyCandidates}},
	domain.TypeDeliveryDueSoon:           {kinds: []LinkKind{LinkVacancyDelivery}},
	domain.TypeDeliveryOverdue:           {kinds: []LinkKind{LinkVacancyDelivery}},
	domain.TypeAssignmentDeadlineDueSoon: {kinds: []LinkKind{LinkVacancyDelivery}},
	domain.TypeAssignmentDeadlineOverdue: {kinds: []LinkKind{LinkVacancyDelivery}},
	domain.TypeVacancyAssigned:           {kinds: []LinkKind{LinkVacancy}},
	domain.TypeVacancyReassigned:         {kinds: []LinkKind{LinkVacancy}},
	domain.TypeVacancyUnassigned:         {kinds: []LinkKind{LinkVacancy}, nullPath: PathMemberUnassignedFallback},
	domain.TypeVacancyTeamAdded:          {kinds: []LinkKind{LinkVacancy}},
	domain.TypeCandidateStatusChanged:    {kinds: []LinkKind{LinkApplication}, nullPath: PathCandidateFallback},
	domain.TypeCandidateMessageReceived:  {kinds: []LinkKind{LinkApplication}, nullPath: PathCandidateFallback},
	domain.TypeCandidateTestPending:      {kinds: []LinkKind{LinkAssessment}, nullPath: PathCandidateFallback},
}

// resolveLink returns the template form and the app_url path. Grouped types
// follow the inbox rule: a participation link (count 1) → .one, the vacancy
// candidates → .many.
func resolveLink(spec domain.Spec, v View) (form, string, error) {
	rule, ok := linkRules[spec.Type]
	if !ok {
		return 0, "", errors.New("email: type has no link rule")
	}
	grouped := spec.Group != domain.GroupSingle
	if v.Link == nil {
		if rule.nullPath == "" {
			return 0, "", errors.New("email: link required for the type")
		}
		return formSingle, rule.nullPath, nil
	}
	allowed := false
	for _, k := range rule.kinds {
		allowed = allowed || k == v.Link.Kind
	}
	if !allowed {
		return 0, "", errors.New("email: link kind does not match the type")
	}
	path, err := linkPath(*v.Link)
	if err != nil {
		return 0, "", err
	}
	if !grouped {
		return formSingle, path, nil
	}
	if v.Link.Kind == LinkParticipation {
		if v.Count != 1 {
			return 0, "", errors.New("email: participation link needs a single notification")
		}
		return formOne, path, nil
	}
	return formMany, path, nil
}

func variable(name string, v View) (string, error) {
	switch name {
	case varCount:
		return strconv.Itoa(v.Count), nil
	case varDateLocal:
		if v.Day.IsZero() {
			return "", errors.New("email: group day required")
		}
		return formatInstantDate(v.Day), nil
	case varCommitmentDate:
		if v.CommitmentDate.IsZero() {
			return "", errors.New("email: commitment date required")
		}
		return formatCivilDate(v.CommitmentDate), nil
	case varFunction:
		return label(functionLabels, v.Function, "function")
	case varReason:
		return label(reasonLabels, v.Reason, "reason")
	case varStatus:
		return label(statusLabels, v.Status, "status")
	}
	return "", errors.New("email: unknown variable")
}

func label(m map[string]string, code, name string) (string, error) {
	if l, ok := m[code]; ok {
		return l, nil
	}
	return "", errors.New("email: unknown " + name + " code")
}

// orFallback cleans a value and falls back when it is nil or blank.
func orFallback(p *string, fallback string) string {
	if p == nil {
		return fallback
	}
	if s := clean(*p); s != "" {
		return s
	}
	return fallback
}

// clean turns control characters into spaces and collapses whitespace runs,
// so a value can never break a header, a text line or the layout.
func clean(s string) string {
	s = strings.Map(func(r rune) rune {
		if unicode.IsControl(r) {
			return ' '
		}
		return r
	}, s)
	return strings.Join(strings.Fields(s), " ")
}
