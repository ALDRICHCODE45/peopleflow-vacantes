package email

import (
	"errors"
	htmlstd "html"
	htmltemplate "html/template"
	"strconv"
	"strings"
	texttemplate "text/template"
	"unicode"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/notifications/domain"
)

// Visual design «03 · Centrada» (S11, user-chosen; frontend clone
// design/notification-emails/03-centrada.html, with the T1–T17 matrix, tone
// map and dark-mode strategy of 04-sistema-de-correo.html). The copy is not
// touched: every template keeps its §Templates line, and the body markup
// below only adds emphasis around it (checked at start-up).

// toneName is the suffix of the .pf-* classes of a tone.
type toneName string

const (
	tonePrimary toneName = "primary"
	toneInfo    toneName = "info"
	toneSuccess toneName = "success"
	toneReview  toneName = "review"
	toneDanger  toneName = "danger"
)

// tone is the light palette of a tone (04 «tones»; the dark values live only
// in the fixed <style> block of the layout). Only these hex constants reach
// the style attributes, never a value from the data.
type tone struct {
	Name                                   toneName
	Text, Tint, Wash, Border, Fill, OnFill string
}

var tones = map[toneName]tone{
	tonePrimary: {tonePrimary, "#7008E7", "#F1E6FD", "#F6F0FE", "#C69CF5", "#7008E7", "#FFFFFF"},
	toneInfo:    {toneInfo, "#0055A9", "#E6EEF6", "#F0F5FA", "#99BBDD", "#0055A9", "#FFFFFF"},
	toneSuccess: {toneSuccess, "#006B30", "#E6F0EA", "#F0F6F3", "#99C4AC", "#006B30", "#FFFFFF"},
	toneReview:  {toneReview, "#844C00", "#F3EDE6", "#F8F4F0", "#CEB799", "#844C00", "#FFFFFF"},
	toneDanger:  {toneDanger, "#A9000C", "#F6E6E7", "#FAF0F0", "#DD999E", "#A9000C", "#FFFFFF"},
}

// Design labels (S11 pending item 1: the design's new microcopy, verbatim).
const (
	eyebrowApplications = "Postulaciones"
	eyebrowTests        = "Pruebas"
	eyebrowDelivery     = "Entrega"
	eyebrowAssignment   = "Asignación"
	eyebrowTeam         = "Equipo"
	urgencyOverdue      = "Vencida"
	urgencyDueSoon      = "Vence pronto"
	labelMandatory      = "Obligatorio"
)

// Seal glyphs (04 matrix «Símbolo»). glyphCount and glyphInitials are
// resolved per delivery: the group's count, the company initials.
const (
	glyphCount    = "{count}"
	glyphInitials = "{initials}"
	// glyphNeutral stands in for initials that cannot be derived.
	glyphNeutral = "…"
)

// candidateFallbackGlyphs replace the initials when a candidate email has no
// company_name, using the matrix vocabulary per type (frontend decision,
// 2026-11-27): status change «→», message «+», pending test «…» (as T5).
var candidateFallbackGlyphs = map[domain.Type]string{
	domain.TypeCandidateStatusChanged:   "→",
	domain.TypeCandidateMessageReceived: "+",
	domain.TypeCandidateTestPending:     "…",
}

// DefaultPostalAddress is the design's placeholder of the legal line, used
// until NOTIFICATIONS_EMAIL_POSTAL_ADDRESS carries the real address (S11
// pending item 2).
const DefaultPostalAddress = "[Dirección postal de PeopleFlow]"

// maxPostalAddressRunes bounds the legal line.
const maxPostalAddressRunes = 200

// templateStyle is the 04 matrix row of a template id. eyebrow "" means the
// candidate form (eyebrow = company_name, glyph = its initials). body is the
// §Templates line with emphasis markers: **x** = variable in 600, !!x!! =
// deadline in the tone color; removing the markers gives the line exactly.
type templateStyle struct {
	tone    toneName
	glyph   string
	eyebrow string
	urgency string
	body    string
}

// templateStyles is closed over the 17 template ids (T1–T17); a missing or
// extra id, an unknown tone, or a body that is not the copy line panics at
// start-up (see compiledStyles).
var templateStyles = map[string]templateStyle{
	"application_received.one":     {tonePrimary, "+", eyebrowApplications, "", "Recibiste una postulación nueva el {{.date_local}}."},
	"application_received.many":    {tonePrimary, glyphCount, eyebrowApplications, "", "Llegaron **{{.count}} postulaciones nuevas** el {{.date_local}}."},
	"psychometric_completed.one":   {toneSuccess, "✓", eyebrowTests, "", "Un candidato de **{{.job_title}}** terminó su prueba psicométrica."},
	"psychometric_completed.many":  {toneSuccess, glyphCount, eyebrowTests, "", "**{{.count}} candidatos** de **{{.job_title}}** terminaron su prueba psicométrica."},
	"psychometric_pending.one":     {tonePrimary, "…", eyebrowTests, "", "Se envió una prueba psicométrica a un candidato de **{{.job_title}}** y aún no la responde."},
	"psychometric_pending.many":    {tonePrimary, glyphCount, eyebrowTests, "", "Se enviaron **{{.count}} pruebas psicométricas** a candidatos de **{{.job_title}}** y aún no las responden."},
	"delivery_due_soon":            {toneReview, "!", eyebrowDelivery, urgencyDueSoon, "La fecha compromiso de **{{.job_title}}** es el !!{{.commitment_date_local}}!!."},
	"delivery_overdue":             {toneDanger, "!", eyebrowDelivery, urgencyOverdue, "La fecha compromiso de **{{.job_title}}** era el !!{{.commitment_date_local}}!!."},
	"assignment_deadline_due_soon": {toneReview, "!", eyebrowDelivery, urgencyDueSoon, "Como **{{.function}}** de **{{.job_title}}**, tu entrega vence el !!{{.commitment_date_local}}!!."},
	"assignment_deadline_overdue":  {toneDanger, "!", eyebrowDelivery, urgencyOverdue, "Tu entrega como **{{.function}}** de **{{.job_title}}** era el !!{{.commitment_date_local}}!!."},
	"vacancy_assigned":             {toneInfo, "→", eyebrowAssignment, "", "Ahora eres responsable de **{{.job_title}}** en **{{.company_name}}**."},
	"vacancy_reassigned":           {toneInfo, "→", eyebrowAssignment, "", "Ahora eres responsable de **{{.job_title}}**. Motivo: **{{.reason}}**."},
	"vacancy_unassigned":           {toneInfo, "→", eyebrowAssignment, "", "Otra persona quedó a cargo de **{{.job_title}}**. Motivo: **{{.reason}}**."},
	"vacancy_team_added":           {toneInfo, "+", eyebrowTeam, "", "Formas parte del equipo de **{{.job_title}}** como **{{.function}}**."},
	"candidate_status_changed":     {tonePrimary, glyphInitials, "", "", "**{{.company_name}}** actualizó tu proceso para **{{.job_title}}**."},
	"candidate_message_received":   {tonePrimary, glyphInitials, "", "", "**{{.company_name}}** te escribió sobre **{{.job_title}}**. Por privacidad no lo incluimos aquí; léelo en PeopleFlow."},
	"candidate_test_pending":       {tonePrimary, glyphInitials, "", "", "**{{.company_name}}** te envió una prueba psicométrica para **{{.job_title}}**."},
}

// Emphasis sentinels: control characters, which clean() removes from every
// data value, so only the markup can produce them.
const (
	sentinelStrong  = "\x02"
	sentinelUrgency = "\x04"
	sentinelEnd     = "\x03"
)

// toSentinels turns the **/!! markers of a style body into sentinels.
func toSentinels(markup string) string {
	var b strings.Builder
	open := ""
	for i := 0; i < len(markup); i++ {
		if i+1 < len(markup) && (markup[i:i+2] == "**" || markup[i:i+2] == "!!") {
			m := markup[i : i+2]
			switch {
			case open == "":
				open = m
				if m == "**" {
					b.WriteString(sentinelStrong)
				} else {
					b.WriteString(sentinelUrgency)
				}
			case open == m:
				open = ""
				b.WriteString(sentinelEnd)
			default:
				panic("email: nested emphasis markers")
			}
			i++
			continue
		}
		b.WriteByte(markup[i])
	}
	if open != "" {
		panic("email: unbalanced emphasis markers")
	}
	return b.String()
}

var stripSentinels = strings.NewReplacer(sentinelStrong, "", sentinelUrgency, "", sentinelEnd, "")

// richBody escapes the body (rendered with sentinels) and turns the
// sentinels into <strong> tags. The tone color is a constant of tones.
func richBody(withSentinels string, t tone) htmltemplate.HTML {
	escaped := htmlstd.EscapeString(withSentinels)
	var b strings.Builder
	for _, r := range escaped {
		switch string(r) {
		case sentinelStrong:
			b.WriteString(`<strong style="font-weight:600">`)
		case sentinelUrgency:
			b.WriteString(`<strong class="pf-t-` + string(t.Name) + `" style="font-weight:600;color:` + t.Text + `">`)
		case sentinelEnd:
			b.WriteString("</strong>")
		default:
			b.WriteRune(r)
		}
	}
	return htmltemplate.HTML(b.String()) //nolint:gosec // every data value was escaped above
}

// connectors are skipped when deriving company initials.
var connectors = map[string]bool{"de": true, "del": true, "la": true, "las": true, "los": true, "el": true, "y": true, "e": true, "en": true, "of": true, "the": true, "and": true}

// companyInitials derives the seal of the candidate templates from
// company_name (04: company_initials): the first letter or digit of the
// first two significant words, upper-cased; "" when there is none.
func companyInitials(name string) string {
	var out []rune
	for _, w := range strings.Fields(name) {
		if connectors[strings.ToLower(w)] {
			continue
		}
		for _, r := range w {
			if unicode.IsLetter(r) || unicode.IsDigit(r) {
				out = append(out, unicode.ToUpper(r))
				break
			}
		}
		if len(out) == 2 {
			break
		}
	}
	return string(out)
}

// sealGlyph resolves the glyph of a style for a delivery: the count (capped
// at «99+»), the company initials (the type's fallback glyph when
// company_name is missing) or the fixed symbol.
func sealGlyph(st templateStyle, typ domain.Type, count int, company string, hasCompany bool) string {
	switch st.glyph {
	case glyphCount:
		if count > 99 {
			return "99+"
		}
		return strconv.Itoa(count)
	case glyphInitials:
		if !hasCompany {
			if g, ok := candidateFallbackGlyphs[typ]; ok {
				return g
			}
			return glyphNeutral
		}
		if in := companyInitials(company); in != "" {
			return in
		}
		return glyphNeutral
	}
	return st.glyph
}

// glyphFontSize follows the design: symbols and short counts at 46 % of the
// 64 px seal, initials and «99+» at 34 %.
func glyphFontSize(g string) int {
	if len([]rune(g)) > 2 || (len([]rune(g)) == 2 && !isDigits(g)) {
		return 22
	}
	return 29
}

func isDigits(s string) bool {
	for _, r := range s {
		if r < '0' || r > '9' {
			return false
		}
	}
	return s != ""
}

// vmlButton is the Outlook desktop button (v:roundrect inside a conditional
// comment, which html/template would strip from the layout text). The URL
// and label are escaped; the width follows the design (9.2 px per character
// + 64).
func vmlButton(url, label string) htmltemplate.HTML {
	width := int(float64(len([]rune(label)))*9.2 + 64 + 0.5)
	return htmltemplate.HTML(`<!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="` + //nolint:gosec // escaped
		htmlstd.EscapeString(url) + `" style="height:52px;v-text-anchor:middle;width:` + strconv.Itoa(width) +
		`px" arcsize="38%" stroke="f" fillcolor="#7008E7"><w:anchorlock/><center style="color:#F5F3FF;font-family:'Segoe UI',Arial,sans-serif;font-size:16px;font-weight:600">` +
		htmlstd.EscapeString(label) + `</center></v:roundrect><![endif]-->`)
}

// msoFragments are the fixed conditional comments of the layout (Outlook
// ghost table, Office settings, non-Outlook guard), emitted through a
// function because html/template drops comments in template text.
var msoFragments = map[string]htmltemplate.HTML{
	"office":     `<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->`,
	"ghostOpen":  `<!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->`,
	"ghostClose": `<!--[if mso]></td></tr></table><![endif]-->`,
	"notMsoOpen": `<!--[if !mso]><!-->`,
	"notMsoEnd":  `<!--<![endif]-->`,
}

func mso(name string) (htmltemplate.HTML, error) {
	f, ok := msoFragments[name]
	if !ok {
		return "", errors.New("email: unknown mso fragment")
	}
	return f, nil
}

// compiledStyle is a style with its body markup parsed (sentinel form).
type compiledStyle struct {
	style templateStyle
	tone  tone
	body  *texttemplate.Template
}

// compiledStyles validates the closed table against templateSpecs: one row
// per id, a known tone, the body equal to the copy line once the markers are
// removed, urgency emphasis only with an urgency pill.
var compiledStyles = func() map[string]compiledStyle {
	if len(templateStyles) != len(templateSpecs) {
		panic("email: template styles do not cover the template map")
	}
	out := make(map[string]compiledStyle, len(templateStyles))
	for _, s := range templateSpecs {
		st, ok := templateStyles[s.id]
		if !ok {
			panic("email: no style for " + s.id)
		}
		tn, ok := tones[st.tone]
		if !ok {
			panic("email: unknown tone for " + s.id)
		}
		sent := toSentinels(st.body)
		if stripSentinels.Replace(sent) != s.line {
			panic("email: style body of " + s.id + " is not its copy line")
		}
		if strings.Contains(sent, sentinelUrgency) && st.urgency == "" {
			panic("email: urgency emphasis without urgency in " + s.id)
		}
		if (st.eyebrow == "") != (st.glyph == glyphInitials) {
			panic("email: candidate form mismatch in " + s.id)
		}
		out[s.id] = compiledStyle{style: st, tone: tn, body: texttemplate.Must(texttemplate.New(s.id + ".body").Option("missingkey=error").Parse(sent))}
	}
	return out
}()
