package http

import (
	"bytes"
	"encoding/csv"
	"net/http/httptest"
	"reflect"
	"testing"
)

func TestGuardFormula(t *testing.T) {
	for in, want := range map[string]string{
		"=SUM(A1)": "'=SUM(A1)", "+1": "'+1", "-1": "'-1", "@x": "'@x", "\tx": "'\tx", "\rx": "'\rx",
		"": "", "Ana": "Ana", "2026-01-01": "2026-01-01", "a=b": "a=b",
	} {
		if got := guardFormula(in); got != want {
			t.Fatalf("%q: %q, want %q", in, got, want)
		}
	}
}

// The stream starts with the BOM, quotes what CSV needs quoted and guards
// every cell, header included.
func TestWriteCSV_BOMQuotingAndGuard(t *testing.T) {
	w := httptest.NewRecorder()
	rows := [][]string{{"=HYPERLINK(\"x\")", "Pérez, Ana", "línea\nnueva"}, {"@SUM", "ok", "-3"}}
	writeCSV(w, "metricas-deliveries-2026-01-01-2026-03-31.csv", []string{"Vacante", "=Nota", "Días"}, len(rows), func(i int) []string { return rows[i] })
	if w.Code != 200 || w.Header().Get("Content-Type") != "text/csv; charset=utf-8" || w.Header().Get("Cache-Control") != "no-store" ||
		w.Header().Get("Content-Disposition") != `attachment; filename="metricas-deliveries-2026-01-01-2026-03-31.csv"` {
		t.Fatalf("%d %v", w.Code, w.Header())
	}
	body := w.Body.Bytes()
	if !bytes.HasPrefix(body, []byte{0xEF, 0xBB, 0xBF}) {
		t.Fatal("no BOM")
	}
	got, err := csv.NewReader(bytes.NewReader(body[3:])).ReadAll()
	if err != nil {
		t.Fatal(err)
	}
	want := [][]string{{"Vacante", "'=Nota", "Días"}, {"'=HYPERLINK(\"x\")", "Pérez, Ana", "línea\nnueva"}, {"'@SUM", "ok", "'-3"}}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("%q", got)
	}
}
