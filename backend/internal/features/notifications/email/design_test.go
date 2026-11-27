package email

import (
	"flag"
	"html"
	"os"
	"path/filepath"
	"reflect"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"testing"

	"github.com/google/uuid"
)

// Design «03 · Centrada» (S11; design/notification-emails/03-centrada.html and
// the T1–T17 matrix of 04-sistema-de-correo.html in the frontend clone).

var updateGolden = flag.Bool("update", false, "rewrite the testdata HTML goldens")

// designRow is the 04 matrix row of a template, written independently of the
// code table: tone, the light hex values of that tone, seal glyph, eyebrow
// label and urgency pill.
type designRow struct {
	tone, fill, tint, glyph, eyebrow, urgency string
}

var designMatrix = map[string]designRow{
	"T1":  {"primary", "#7008E7", "#F1E6FD", "+", "Postulaciones", ""},
	"T2":  {"primary", "#7008E7", "#F1E6FD", "3", "Postulaciones", ""},
	"T3":  {"success", "#006B30", "#E6F0EA", "✓", "Pruebas", ""},
	"T4":  {"success", "#006B30", "#E6F0EA", "2", "Pruebas", ""},
	"T5":  {"primary", "#7008E7", "#F1E6FD", "…", "Pruebas", ""},
	"T6":  {"primary", "#7008E7", "#F1E6FD", "4", "Pruebas", ""},
	"T7":  {"review", "#844C00", "#F3EDE6", "!", "Entrega", "Vence pronto"},
	"T8":  {"danger", "#A9000C", "#F6E6E7", "!", "Entrega", "Vencida"},
	"T9":  {"review", "#844C00", "#F3EDE6", "!", "Entrega", "Vence pronto"},
	"T10": {"danger", "#A9000C", "#F6E6E7", "!", "Entrega", "Vencida"},
	"T11": {"info", "#0055A9", "#E6EEF6", "→", "Asignación", ""},
	"T12": {"info", "#0055A9", "#E6EEF6", "→", "Asignación", ""},
	"T13": {"info", "#0055A9", "#E6EEF6", "→", "Asignación", ""},
	"T14": {"info", "#0055A9", "#E6EEF6", "+", "Equipo", ""},
	// Candidate templates: the company initials and name (Acme Talento).
	"T15": {"primary", "#7008E7", "#F1E6FD", "AT", "Acme Talento", ""},
	"T16": {"primary", "#7008E7", "#F1E6FD", "AT", "Acme Talento", ""},
	"T17": {"primary", "#7008E7", "#F1E6FD", "AT", "Acme Talento", ""},
}

// Every template renders the 03 anatomy with its tone, glyph, eyebrow,
// urgency and the «Obligatorio» pill exactly on the mandatory (F2) types.
func TestRenderDesignPerTemplate(t *testing.T) {
	for _, g := range goldens() {
		t.Run(g.name, func(t *testing.T) {
			row, ok := designMatrix[g.name]
			if !ok {
				t.Fatal("no matrix row")
			}
			m, err := newTestRenderer(t, &fakeSigner{}).Render(g.view)
			if err != nil {
				t.Fatal(err)
			}
			glyphSize := "29px" // symbols and counts up to two digits
			if g.view.Company == uuid.Nil {
				glyphSize = "22px" // company initials
			}
			for _, want := range []string{
				// 4 px tone bar
				`<td height="4" class="pf-fill-` + row.tone + `" bgcolor="` + row.fill + `" style="height:4px;background-color:` + row.fill + `;`,
				// 64 px circular seal with the glyph
				`<td width="64" height="64" align="center" valign="middle" class="pf-tint-` + row.tone + ` pf-t-` + row.tone + `" bgcolor="` + row.tint + `" style="width:64px;height:64px;border-radius:50%;background-color:` + row.tint + `;color:` + row.fill + `;`,
				"font-size:" + glyphSize + ";line-height:64px;",
				`aria-hidden="true">` + htmlGlyph(row.glyph) + `</td>`,
				// eyebrow in the tone
				`<td class="pf-t-` + row.tone + `" style="font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:13px;line-height:20px;font-weight:600;color:` + row.fill + `;white-space:nowrap">` + row.eyebrow + `</td>`,
				// 28 px centered title
				`font-size:28px;line-height:36px;font-weight:700;letter-spacing:-0.01em;color:#1A1626;text-align:center">` + g.heading + `</h1>`,
				// live-text wordmark linking to the app
				`<a href="` + testBase + `" style="text-decoration:none;display:inline-block" aria-label="PeopleFlow"><span class="pf-wm-p"`,
				`>people</span><span class="pf-wm-f"`, `>flow</span></a>`,
				// legal line with the placeholder address
				`>PeopleFlow · [Dirección postal de PeopleFlow]</p>`,
				// preheader = plain body line
				`mso-hide:all;font-size:1px;line-height:1px;color:#FFFFFF">` + html.EscapeString(g.line) + `&#8199;&#847;`,
			} {
				if !strings.Contains(m.HTML, want) {
					t.Errorf("html lacks %q", want)
				}
			}
			urgencyPill := `pf-fill-` + row.tone + ` pf-on-` + row.tone + ` pf-bd-` + row.tone + `" bgcolor="` + row.fill + `"`
			if row.urgency != "" {
				if !strings.Contains(m.HTML, urgencyPill) || !strings.Contains(m.HTML, `>`+row.urgency+`</td>`) {
					t.Errorf("urgency pill %q missing", row.urgency)
				}
			} else if strings.Contains(m.HTML, ">Vencida</td>") || strings.Contains(m.HTML, ">Vence pronto</td>") {
				t.Error("urgency pill on a template without urgency")
			}
			if got := strings.Contains(m.HTML, `pf-tint-neutral pf-bd-neutral pf-t-neutral" bgcolor="#F0F0F2"`) && strings.Contains(m.HTML, ">Obligatorio</td>"); got != g.mandatory {
				t.Errorf("«Obligatorio» pill present=%v, mandatory=%v", got, g.mandatory)
			}
			if strings.Contains(m.HTML, "ZgotmplZ") {
				t.Error("html/template rejected a value (ZgotmplZ)")
			}
		})
	}
}

// The body line keeps the verbatim copy; variables are emphasized (600) and
// the deadline date of the urgent templates takes the tone color.
func TestRenderBodyEmphasis(t *testing.T) {
	s := func(v string) string { return `<strong style="font-weight:600">` + v + `</strong>` }
	u := func(tone, hex, v string) string {
		return `<strong class="pf-t-` + tone + `" style="font-weight:600;color:` + hex + `">` + v + `</strong>`
	}
	job, date := s("Analista de Datos"), "1 de diciembre de 2026"
	want := map[string]string{
		"T1":  "Recibiste una postulación nueva el 26 de noviembre de 2026.",
		"T2":  "Llegaron " + s("3 postulaciones nuevas") + " el 26 de noviembre de 2026.",
		"T3":  "Un candidato de " + job + " terminó su prueba psicométrica.",
		"T4":  s("2 candidatos") + " de " + job + " terminaron su prueba psicométrica.",
		"T5":  "Se envió una prueba psicométrica a un candidato de " + job + " y aún no la responde.",
		"T6":  "Se enviaron " + s("4 pruebas psicométricas") + " a candidatos de " + job + " y aún no las responden.",
		"T7":  "La fecha compromiso de " + job + " es el " + u("review", "#844C00", date) + ".",
		"T8":  "La fecha compromiso de " + job + " era el " + u("danger", "#A9000C", date) + ".",
		"T9":  "Como " + s("responsable") + " de " + job + ", tu entrega vence el " + u("review", "#844C00", date) + ".",
		"T10": "Tu entrega como " + s("colaborador") + " de " + job + " era el " + u("danger", "#A9000C", date) + ".",
		"T11": "Ahora eres responsable de " + job + " en " + s("Acme Talento") + ".",
		"T12": "Ahora eres responsable de " + job + ". Motivo: " + s("carga de trabajo") + ".",
		"T13": "Otra persona quedó a cargo de " + job + ". Motivo: " + s("salida del reclutador") + ".",
		"T14": "Formas parte del equipo de " + job + " como " + s("integrante") + ".",
		"T15": s("Acme Talento") + " actualizó tu proceso para " + job + ".",
		"T16": s("Acme Talento") + " te escribió sobre " + job + ". Por privacidad no lo incluimos aquí; léelo en PeopleFlow.",
		"T17": s("Acme Talento") + " te envió una prueba psicométrica para " + job + ".",
	}
	for _, g := range goldens() {
		m, err := newTestRenderer(t, &fakeSigner{}).Render(g.view)
		if err != nil {
			t.Fatal(err)
		}
		p := `font-size:17px;line-height:28px;color:#1A1626;text-align:center">` + want[g.name] + `</p>`
		if !strings.Contains(m.HTML, p) {
			t.Errorf("%s: body\nwant %s\nhtml %s", g.name, p, between(m.HTML, `pf-ink pf-body`, `</p>`))
		}
	}
}

// The emphasis markup of the body never changes the words: with its markers
// removed it is the §Templates line byte for byte.
func TestBodyMarkupKeepsTheCopy(t *testing.T) {
	if len(templateStyles) != len(templateSpecs) {
		t.Fatalf("%d styles for %d templates", len(templateStyles), len(templateSpecs))
	}
	for _, s := range templateSpecs {
		st, ok := templateStyles[s.id]
		if !ok {
			t.Fatalf("%s: no style", s.id)
		}
		plain := strings.NewReplacer("**", "", "!!", "").Replace(st.body)
		if plain != s.line {
			t.Errorf("%s: markup %q is not the line %q", s.id, st.body, s.line)
		}
		if strings.Contains(st.body, "!!") && st.urgency == "" {
			t.Errorf("%s: urgency emphasis without urgency", s.id)
		}
	}
}

// Outlook desktop gets the VML button (52 px, width from the label) and the
// 600 px ghost table; other clients the padded link.
func TestRenderVMLButton(t *testing.T) {
	for _, g := range goldens() {
		m, err := newTestRenderer(t, &fakeSigner{}).Render(g.view)
		if err != nil {
			t.Fatal(err)
		}
		width := int(float64(len([]rune(g.button)))*9.2 + 64 + 0.5)
		for _, want := range []string{
			`<!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->`,
			`<!--[if mso]></td></tr></table><![endif]-->`,
			`<!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="` + htmlAttr(g.appURL) + `" style="height:52px;v-text-anchor:middle;width:` + strconv.Itoa(width) + `px" arcsize="38%" stroke="f" fillcolor="#7008E7"><w:anchorlock/><center style="color:#F5F3FF;font-family:'Segoe UI',Arial,sans-serif;font-size:16px;font-weight:600">` + g.button + `</center></v:roundrect><![endif]-->`,
			`<!--[if !mso]><!--><a href="` + htmlAttr(g.appURL) + `" class="pf-btn pf-btn-t pf-btn-a" style="display:inline-block;padding:16px 28px;`,
			`>` + g.button + `</a><!--<![endif]-->`,
			`xmlns:v="urn:schemas-microsoft-com:vml"`,
			`<o:PixelsPerInch>96</o:PixelsPerInch>`,
		} {
			if !strings.Contains(m.HTML, want) {
				t.Errorf("%s: html lacks %q", g.name, want)
			}
		}
	}
}

// Dark mode is client-side: color-scheme metas, the prefers-color-scheme
// block and the Outlook.com [data-ogsc]/[data-ogsb] rules.
func TestRenderDarkModeCSS(t *testing.T) {
	m, err := newTestRenderer(t, &fakeSigner{}).Render(goldens()[7].view)
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{
		`<meta name="color-scheme" content="light dark">`,
		`<meta name="supported-color-schemes" content="light dark">`,
		`:root{color-scheme:light dark;supported-color-schemes:light dark}`,
		`@media (prefers-color-scheme:dark){.pf-bg{background-color:#0C0912 !important}.pf-card{background-color:#15121F !important}`,
		`.pf-t-danger{color:#FF8482 !important}`,
		`[data-ogsc] .pf-ink{color:#F6F2FF !important}`,
		`[data-ogsc] .pf-wm-f{color:#A28CED !important}`,
		`[data-ogsb] .pf-card{background-color:#15121F !important}`,
		`[data-ogsb] .pf-fill-danger{background-color:#FF8482 !important}`,
		`@media (max-width:620px){`,
		`<body class="pf-card" style="margin:0;padding:0;background-color:#FFFFFF">`,
	} {
		if !strings.Contains(m.HTML, want) {
			t.Errorf("html lacks %q", want)
		}
	}
}

// D14: the visible HTML text is the copy, the labels and the fixed design
// strings only — no name, address or id can appear. Everything the renderer
// knows about a person is in View, whose fields are pinned here.
func TestRenderVisibleTextIsOnlyCopy(t *testing.T) {
	var fields []string
	for _, f := range reflect.VisibleFields(reflect.TypeOf(View{})) {
		fields = append(fields, f.Name)
	}
	if got := strings.Join(fields, ","); got != "DeliveryID,Type,To,User,Company,Count,Link,JobTitle,CompanyName,Day,CommitmentDate,Function,Reason,Status" {
		t.Fatalf("View fields changed (D14 review needed): %s", got)
	}
	for _, g := range goldens() {
		m, err := newTestRenderer(t, &fakeSigner{}).Render(g.view)
		if err != nil {
			t.Fatal(err)
		}
		row := designMatrix[g.name]
		visible := visibleText(m.HTML)
		known := []string{
			g.subject, g.line, g.heading, g.button, f1Line, f2Line, "Mis preferencias", "Dejar de recibir este tipo de correo",
			"PeopleFlow · [Dirección postal de PeopleFlow]", "people", "flow", row.eyebrow, row.urgency, "Obligatorio", row.glyph, "·",
		}
		// Longest first, so a subject never eats part of a longer line.
		sort.Slice(known, func(i, j int) bool { return len(known[i]) > len(known[j]) })
		for _, k := range known {
			if k != "" {
				visible = strings.ReplaceAll(visible, k, " ")
			}
		}
		if rest := strings.TrimSpace(strings.Map(func(r rune) rune {
			if r == '\u2007' || r == '\u034f' || r == '\u00a0' { // preheader padding, &nbsp;
				return ' '
			}
			return r
		}, visible)); rest != "" {
			t.Errorf("%s: unexpected visible text %q", g.name, rest)
		}
	}
}

// The footer's legal line takes the postal address of the settings
// (NOTIFICATIONS_EMAIL_POSTAL_ADDRESS), escaped; empty → the placeholder.
func TestRenderPostalAddress(t *testing.T) {
	r, err := NewRenderer(Settings{From: testFrom, AppBaseURL: testBase, UnsubscribeURL: testUnsubscribe,
		PostalAddress: "Av. Paseo de la Reforma 222, Juárez, 06600 CDMX <MX>"}, &fakeSigner{})
	if err != nil {
		t.Fatal(err)
	}
	g := goldens()[1]
	m, err := r.Render(g.view)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(m.HTML, ">PeopleFlow · Av. Paseo de la Reforma 222, Juárez, 06600 CDMX &lt;MX&gt;</p>") || strings.Contains(m.HTML, "[Dirección postal") {
		t.Fatalf("postal address not used:\n%s", between(m.HTML, "pf-muted", "</table>"))
	}
	if m.Text != expectedText(g) {
		t.Fatalf("text part changed: %q", m.Text)
	}
	if DefaultPostalAddress != "[Dirección postal de PeopleFlow]" {
		t.Fatalf("placeholder %q", DefaultPostalAddress)
	}
	m, err = newTestRenderer(t, &fakeSigner{}).Render(g.view)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(m.HTML, ">PeopleFlow · [Dirección postal de PeopleFlow]</p>") {
		t.Fatal("placeholder missing")
	}
	for name, addr := range map[string]string{
		"control characters": "Calle 1\r\nBcc: x@y.test",
		"too long":           strings.Repeat("a", 201),
	} {
		if _, err := NewRenderer(Settings{From: testFrom, AppBaseURL: testBase, UnsubscribeURL: testUnsubscribe, PostalAddress: addr}, &fakeSigner{}); err == nil {
			t.Errorf("%s accepted", name)
		}
	}
}

// Company initials are derived server-side from company_name (no new data):
// first letters of the first two significant words.
func TestCompanyInitials(t *testing.T) {
	for in, want := range map[string]string{
		"Grupo Altavista":           "GA",
		"Constructora Sierra Madre": "CS",
		"acme":                      "A",
		"Grupo de Talento":          "GT",
		"  élite   consultores ":    "ÉC",
		"3M México":                 "3M",
		"(Nueva) Empresa":           "NE",
		"!!!":                       "",
		"":                          "",
	} {
		if got := companyInitials(in); got != want {
			t.Errorf("companyInitials(%q) = %q, want %q", in, got, want)
		}
	}
}

// A candidate email without company name keeps the copy fallback, drops the
// eyebrow and shows the neutral glyph instead of initials of «una empresa».
func TestRenderCandidateWithoutCompany(t *testing.T) {
	g := goldens()[16]
	g.view.CompanyName = nil
	m, err := newTestRenderer(t, &fakeSigner{}).Render(g.view)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(m.HTML, `aria-hidden="true">…</td>`) || strings.Contains(m.HTML, `aria-hidden="true">UE</td>`) {
		t.Fatalf("seal:\n%s", between(m.HTML, `width="64"`, `</td>`))
	}
	if strings.Contains(m.HTML, `white-space:nowrap">una empresa</td>`) || strings.Contains(m.HTML, `font-size:13px;line-height:20px;font-weight:600`) {
		t.Fatal("eyebrow rendered without company")
	}
	if !strings.Contains(m.HTML, `<strong style="font-weight:600">una empresa</strong> te envió`) {
		t.Fatal("copy fallback missing")
	}
}

// Large groups cap the seal at «99+»; the heading still carries the count.
func TestRenderGlyphCapsTheCount(t *testing.T) {
	g := goldens()[1]
	g.view.Count = 128
	m, err := newTestRenderer(t, &fakeSigner{}).Render(g.view)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(m.HTML, `font-size:22px;line-height:64px;`) || !strings.Contains(m.HTML, `aria-hidden="true">99&#43;</td>`) || !strings.Contains(m.HTML, ">128 postulaciones nuevas en Analista de Datos</h1>") {
		t.Fatalf("seal:\n%s", between(m.HTML, `width="64"`, `</td>`))
	}
}

// Body emphasis escapes the values: markup in a job title stays text.
func TestRenderBodyEscapesInsideEmphasis(t *testing.T) {
	g := goldens()[7]
	g.view.JobTitle = ptr(`**<i>x</i>** !!y!! & "z"`)
	m, err := newTestRenderer(t, &fakeSigner{}).Render(g.view)
	if err != nil {
		t.Fatal(err)
	}
	want := `La fecha compromiso de <strong style="font-weight:600">**&lt;i&gt;x&lt;/i&gt;** !!y!! &amp; &#34;z&#34;</strong> era el `
	if !strings.Contains(m.HTML, want) || strings.Contains(m.HTML, "<i>") {
		t.Fatalf("body:\n%s", between(m.HTML, `pf-ink pf-body`, `</p>`))
	}
}

// Full literal HTML goldens (go test -run TestRenderHTMLGoldens -update):
// T2 (group, F1), T8 (mandatory urgent, F2), T12 (mandatory, F2), T15 and
// T17 (candidate) — the five templates of the design samples.
func TestRenderHTMLGoldens(t *testing.T) {
	gs := goldens()
	for _, i := range []int{1, 7, 11, 14, 16} {
		g := gs[i]
		m, err := newTestRenderer(t, &fakeSigner{}).Render(g.view)
		if err != nil {
			t.Fatal(err)
		}
		path := filepath.Join("testdata", strings.ToLower(g.name)+".html")
		if *updateGolden {
			if err := os.WriteFile(path, []byte(m.HTML), 0o644); err != nil {
				t.Fatal(err)
			}
			continue
		}
		want, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		if m.HTML != string(want) {
			t.Errorf("%s: HTML differs from %s (rerun with -update after review)", g.name, path)
		}
	}
}

var (
	reStyle   = regexp.MustCompile(`(?s)<style.*?</style>|<title>.*?</title>`)
	reComment = regexp.MustCompile(`(?s)<!--.*?-->`)
	reTag     = regexp.MustCompile(`(?s)<[^>]*>`)
	reInline  = regexp.MustCompile(`</?strong[^>]*>`)
)

// htmlGlyph is how html/template writes a glyph in text (+ → &#43;).
func htmlGlyph(g string) string { return strings.ReplaceAll(g, "+", "&#43;") }

func visibleText(h string) string {
	h = reStyle.ReplaceAllString(h, " ")
	h = reComment.ReplaceAllString(h, " ")
	h = reInline.ReplaceAllString(h, "")
	h = reTag.ReplaceAllString(h, " ")
	return html.UnescapeString(h)
}

func between(s, from, to string) string {
	i := strings.Index(s, from)
	if i < 0 {
		return ""
	}
	j := strings.Index(s[i:], to)
	if j < 0 {
		return s[i:]
	}
	return s[i : i+j+len(to)]
}
