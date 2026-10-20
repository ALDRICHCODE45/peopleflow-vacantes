package catalog

import (
	"strings"
	"testing"
	"testing/fstest"
)

func fixture() fstest.MapFS {
	return fstest.MapFS{
		"countries.csv":         {Data: []byte("country_code,name_es,name_en\nMX,México,Mexico\nUS,Estados Unidos,United States\n")},
		"mx_states.csv":         {Data: []byte("state_code,name,abbreviation\n01,Aguascalientes,Ags.\n")},
		"mx_municipalities.csv": {Data: []byte("state_code,municipality_code,name\n01,01001,Aguascalientes\n")},
		"mx_postal_codes.csv":   {Data: []byte("d_codigo,c_estado,c_mnpio\n01000,01,001\n01000,01,001\n99999,01,999\n")},
	}
}
func TestReadCSV(t *testing.T) {
	files := fixture()
	data, skipped, err := ReadCSV(files)
	if err != nil {
		t.Fatal(err)
	}
	if len(data.Countries) != 2 || len(data.PostalCodes) != 1 || data.PostalCodes[0].PostalCode != "01000" || len(skipped) != 1 || !strings.Contains(skipped[0], "01999") {
		t.Fatalf("%+v skipped=%v", data, skipped)
	}
	for _, tc := range []struct{ name, file, content string }{
		{"bad country", "countries.csv", "country_code,name_es,name_en\nmx,México,Mexico\n"},
		{"wrong header", "mx_states.csv", "code,label\n01,Aguascalientes\n"},
		{"bad state", "mx_states.csv", "state_code,name,abbreviation\n1,Aguascalientes,Ags.\n"},
		{"wrong prefix", "mx_municipalities.csv", "state_code,municipality_code,name\n01,02001,Name\n"},
		{"bad postal", "mx_postal_codes.csv", "d_codigo,c_estado,c_mnpio\n1234,01,001\n"},
		{"duplicate country", "countries.csv", "country_code,name_es,name_en\nMX,México,Mexico\nMX,México,Mexico\n"},
		{"empty file", "mx_postal_codes.csv", "d_codigo,c_estado,c_mnpio\n"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			f := fixture()
			f[tc.file] = &fstest.MapFile{Data: []byte(tc.content)}
			if _, _, err := ReadCSV(f); err == nil {
				t.Fatal("accepted invalid source")
			}
		})
	}
}
func TestReadCSVWithoutPostalCodes(t *testing.T) {
	all := fixture()
	files := fstest.MapFS{
		"countries.csv":         all["countries.csv"],
		"mx_states.csv":         all["mx_states.csv"],
		"mx_municipalities.csv": all["mx_municipalities.csv"],
	}
	data, skipped, err := ReadCSVWithOptions(files, Options{SkipPostalCodes: true})
	if err != nil || len(data.Countries) != 2 || len(data.States) != 1 || len(data.Municipalities) != 1 || len(data.PostalCodes) != 0 || len(skipped) != 0 {
		t.Fatalf("base-only import requires no postal file: data=%+v skipped=%v err=%v", data, skipped, err)
	}
	if _, _, err := ReadCSV(files); err == nil {
		t.Fatal("default import must still require the postal file")
	}
	files["mx_postal_codes.csv"] = &fstest.MapFile{Data: []byte("untrusted malformed data")}
	if _, _, err := ReadCSVWithOptions(files, Options{SkipPostalCodes: true}); err != nil {
		t.Fatal("skipped postal file must not be parsed", err)
	}
	if _, _, err := Validate(data); err == nil {
		t.Fatal("default all-catalog validation must still require postal data")
	}
}

func TestReducePostal(t *testing.T) {
	raw := "Notice from the source\nd_codigo|d_asenta|c_estado|c_mnpio\n01000|ignored|01|001\n01000|different settlement|01|001\n02000|ignored|02|002\n"
	rows, err := ReducePostal(strings.NewReader(raw))
	if err != nil || len(rows) != 2 || rows[0].PostalCode != "01000" || rows[0].MunicipalityCode != "01001" {
		t.Fatal(rows, err)
	}
	for _, raw := range []string{"no header", "d_codigo|c_estado|c_mnpio\n123|01|001\n", "d_codigo|c_estado|c_mnpio\n12345|01\n"} {
		if _, err := ReducePostal(strings.NewReader(raw)); err == nil {
			t.Fatalf("accepted %q", raw)
		}
	}
}
