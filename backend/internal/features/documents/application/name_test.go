package documents_test

import (
	"errors"
	"strings"
	"testing"

	documents "github.com/aldrichcode45/peopleflow-vacantes/internal/features/documents/application"
)

func TestStripKnownExtension(t *testing.T) {
	for in, want := range map[string]string{
		"contrato.pdf":        "contrato",
		"contrato.PDF":        "contrato",
		"Contrato.DocX":       "Contrato",
		"hoja.xlsx":           "hoja",
		"foto.jpg":            "foto",
		"foto.JPEG":           "foto",
		"scan.png":            "scan",
		"contrato.pdf.docx":   "contrato.pdf",
		"contrato.pdf.pdf":    "contrato.pdf",
		"contrato.doc":        "contrato.doc",
		"datos.xls":           "datos.xls",
		"archivo.zip":         "archivo.zip",
		"informe 2.0":         "informe 2.0",
		"sin extension":       "sin extension",
		"pdf":                 "pdf",
		"contrato.pdf  ":      "contrato",
		"contrato .pdf":       "contrato ",
		".pdf":                "",
		"dir.pdf/contrato":    "dir.pdf/contrato",
		"Candidato Ñandú.pdf": "Candidato Ñandú",
	} {
		if got := documents.StripKnownExtension(in); got != want {
			t.Errorf("StripKnownExtension(%q)=%q want %q", in, got, want)
		}
	}
}

func TestNormalizeGivenName(t *testing.T) {
	for in, want := range map[string]string{
		"Contrato":                "Contrato",
		"  Contrato   firmado  ":  "Contrato firmado",
		"contrato.pdf":            "contrato",
		"Oferta.DOCX":             "Oferta",
		"e\u0301":                 "é",
		"Tabla\tde\nsueldos.xlsx": "Tabla de sueldos",
		strings.Repeat("ñ", 120):  strings.Repeat("ñ", 120),
		"a.b.pdf":                 "a.b",
	} {
		got, err := documents.NormalizeGivenName(in)
		if err != nil || got != want {
			t.Errorf("NormalizeGivenName(%q)=%q %v want %q", in, got, err, want)
		}
	}
	for name, in := range map[string]string{
		"empty":               "",
		"blank":               "   ",
		"only extension":      ".pdf",
		"blank and extension": "  .DOCX ",
		"control":             "a\x00b",
		"bell":                "a\x07b",
		"121 runes":           strings.Repeat("ñ", 121),
		"121 after strip":     strings.Repeat("a", 121) + ".pdf",
		"invalid utf8":        "a\xffb",
	} {
		got, err := documents.NormalizeGivenName(in)
		if !errors.Is(err, documents.ErrInvalidName) || got != "" {
			t.Errorf("%s: NormalizeGivenName(%q)=%q %v", name, in, got, err)
		}
	}
}

func TestDefaultName(t *testing.T) {
	for in, want := range map[string]string{
		"contrato.pdf":                    "contrato",
		"Contrato Final.DOCX":             "Contrato Final",
		"C:\\Users\\ana\\oferta.xlsx":     "oferta",
		"/tmp/uploads/escaneo.JPEG":       "escaneo",
		"cv.final.png":                    "cv.final",
		"sin-extension":                   "sin-extension",
		".pdf":                            "Documento",
		"":                                "Documento",
		"   ":                             "Documento",
		"dir/.docx":                       "Documento",
		"dir/":                            "Documento",
		"a\x00b.pdf":                      "Documento",
		strings.Repeat("a", 121) + ".pdf": strings.Repeat("a", 120), // truncated, never rejected
		strings.Repeat("ñ", 130):          strings.Repeat("ñ", 120),
	} {
		if got := documents.DefaultName(in); got != want {
			t.Errorf("DefaultName(%q)=%q want %q", in, got, want)
		}
	}
}

func TestDownloadName(t *testing.T) {
	for _, tc := range []struct {
		name   string
		format documents.Format
		want   string
	}{
		{"contrato", documents.PDF, "contrato.pdf"},
		{"contrato", documents.DOCX, "contrato.docx"}, // a PDF replaced by a DOCX: never contrato.pdf.docx
		{"hoja", documents.XLSX, "hoja.xlsx"},
		{"foto", documents.JPG, "foto.jpg"},
		{"scan", documents.PNG, "scan.png"},
		{"CV Juan Pérez", documents.PDF, "CV Juan Pérez.pdf"},
		{"informe 2.0", documents.PDF, "informe 2.0.pdf"},
		{"contrato", "", "contrato"},
	} {
		if got := documents.DownloadName(tc.name, tc.format); got != tc.want {
			t.Errorf("DownloadName(%q,%q)=%q want %q", tc.name, tc.format, got, tc.want)
		}
	}
}

// A name stored after the strip never doubles the extension on download, even
// when the user uploaded «contrato.pdf» and later replaced it with a Word file.
func TestStrippedNameThenDownloadNameNeverDoublesTheExtension(t *testing.T) {
	name, err := documents.NormalizeGivenName("contrato.pdf")
	if err != nil {
		t.Fatal(err)
	}
	if got := documents.DownloadName(name, documents.DOCX); got != "contrato.docx" {
		t.Fatalf("got %q", got)
	}
}
