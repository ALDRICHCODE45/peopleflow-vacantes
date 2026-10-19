package catalog

import (
	"archive/zip"
	"bytes"
	"os"
	"reflect"
	"strings"
	"testing"
	"testing/fstest"
)

func rawFixture(t *testing.T) fstest.MapFS {
	t.Helper()
	var archive bytes.Buffer
	z := zip.NewWriter(&archive)
	f, err := z.Create("CPdescarga.txt")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = f.Write([]byte("Source notice\r\nd_codigo|d_asenta|c_estado|c_mnpio\r\n01000|Unquoted \"name|01|001\r\n01000|another|01|001\r\n01000|second municipality|01|002\r\n99999|not in INEGI|01|999\r\n")); err != nil {
		t.Fatal(err)
	}
	if err = z.Close(); err != nil {
		t.Fatal(err)
	}
	return fstest.MapFS{
		"iso-countries/iso3166-1.json":                {Data: []byte(`{"3166-1":[{"alpha_2":"MX"},{"alpha_2":"US"}]}`)},
		"cldr-es/territories.json":                    {Data: []byte(`{"main":{"es":{"localeDisplayNames":{"territories":{"MX":"México","US":"Estados Unidos","XK":"not ISO"}}}}}`)},
		"cldr-en/territories.json":                    {Data: []byte(`{"main":{"en":{"localeDisplayNames":{"territories":{"MX":"Mexico","US":"United States"}}}}}`)},
		"inegi-states/states.json":                    {Data: []byte(`{"datos":[{"cve_ent":"01","nomgeo":"Aguascalientes","nom_abrev":"Ags."}]}`)},
		"inegi-municipalities-01/municipalities.json": {Data: []byte(`{"datos":[{"cvegeo":"01001","cve_ent":"01","cve_mun":"001","nomgeo":"Aguascalientes"},{"cvegeo":"01002","cve_ent":"01","cve_mun":"002","nomgeo":"Asientos"}]}`)},
		"sepomex/CPdescarga.zip":                      {Data: archive.Bytes()},
	}
}
func TestReduceAndRoundtrip(t *testing.T) {
	data, skipped, err := Reduce(rawFixture(t))
	if err != nil {
		t.Fatal(err)
	}
	if len(data.Countries) != 2 || len(data.States) != 1 || len(data.Municipalities) != 2 || len(data.PostalCodes) != 2 || len(skipped) != 1 {
		t.Fatal(data, skipped)
	}
	dir := t.TempDir()
	if err = WriteCSV(dir, data); err != nil {
		t.Fatal(err)
	}
	restored, skipped, err := ReadCSV(os.DirFS(dir))
	if err != nil || len(skipped) != 0 || !reflect.DeepEqual(data, restored) {
		t.Fatal("roundtrip", restored, skipped, err)
	}
	for _, tc := range []struct{ name, file, body string }{
		{"missing translations", "cldr-es/territories.json", `{}`},
		{"malformed ISO", "iso-countries/iso3166-1.json", `not JSON`},
		{"wrong state pair", "inegi-municipalities-01/municipalities.json", `{"datos":[{"cvegeo":"02001","cve_ent":"02","cve_mun":"001","nomgeo":"Wrong"}]}`},
		{"missing municipality payload", "inegi-municipalities-01/municipalities.json", `{}`},
		{"invalid zip", "sepomex/CPdescarga.zip", `not a zip`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			files := rawFixture(t)
			files[tc.file] = &fstest.MapFile{Data: []byte(tc.body)}
			if _, _, err := Reduce(files); err == nil {
				t.Fatal("accepted incomplete source")
			}
		})
	}
}
func TestVersionedCatalog(t *testing.T) {
	data, skipped, err := ReadCSV(os.DirFS("../../../../../db/geo"))
	if err != nil {
		t.Fatal(err)
	}
	if len(skipped) != 0 || len(data.Countries) != 249 || len(data.States) != 32 || len(data.Municipalities) != 2478 || len(data.PostalCodes) != 31867 {
		t.Fatalf("unexpected snapshot counts: %d/%d/%d/%d skipped=%v", len(data.Countries), len(data.States), len(data.Municipalities), len(data.PostalCodes), skipped)
	}
	for _, c := range data.Countries {
		if c.Code == "MX" && c.NameEs != "México" {
			t.Fatal(c)
		}
	}
	for _, p := range data.PostalCodes {
		if len(p.PostalCode) != 5 || strings.Contains(p.MunicipalityCode, " ") {
			t.Fatal(p)
		}
	}
}
