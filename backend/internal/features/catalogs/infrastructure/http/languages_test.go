package http_test

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	catalogs "github.com/aldrichcode45/peopleflow-vacantes/internal/features/catalogs/infrastructure/http"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/shared/languages"
	"golang.org/x/text/collate"
	"golang.org/x/text/language"
)

func TestLanguagesAnonymousCacheContract(t *testing.T) {
	request := func(tags ...string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(http.MethodGet, "/v2/catalogs/languages", nil)
		for _, tag := range tags {
			r.Header.Add("If-None-Match", tag)
		}
		w := httptest.NewRecorder()
		catalogs.Languages(w, r)
		return w
	}
	w := request()
	if w.Code != 200 || w.Header().Get("Cache-Control") != "public, max-age=86400" || w.Header().Get("Content-Type") != "application/json" {
		t.Fatalf("response %d %v", w.Code, w.Header())
	}
	wantTag := fmt.Sprintf(`"%x"`, sha256.Sum256(w.Body.Bytes()))
	if w.Header().Get("ETag") != wantTag {
		t.Fatalf("etag %s", w.Header().Get("ETag"))
	}
	var body map[string][]map[string]string
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if len(body) != 1 || len(body["items"]) != len(languages.All()) {
		t.Fatal("body keys/count")
	}
	c := collate.New(language.Spanish, collate.IgnoreCase, collate.IgnoreDiacritics)
	for i, item := range body["items"] {
		if len(item) != 2 || item["code"] == "" || item["name"] == "" {
			t.Fatal("item shape")
		}
		if i > 0 {
			prev := body["items"][i-1]
			order := c.CompareString(prev["name"], item["name"])
			if order > 0 || (order == 0 && prev["code"] >= item["code"]) {
				t.Fatal("unsorted")
			}
		}
	}
	for _, tags := range [][]string{{wantTag}, {"W/" + wantTag}, {`"stale", ` + wantTag}, {"*"}, {`"stale"`, wantTag}} {
		w := request(tags...)
		if w.Code != 304 || w.Body.Len() != 0 || w.Header().Get("ETag") != wantTag || w.Header().Get("Cache-Control") != "public, max-age=86400" {
			t.Fatalf("conditional %v: %d %v", tags, w.Code, w.Header())
		}
	}
	for _, tag := range []string{`"stale"`, wantTag + "suffix"} {
		if w := request(tag); w.Code != 200 {
			t.Fatalf("nonmatch %s: %d", tag, w.Code)
		}
	}
	if again := request(); again.Body.String() != w.Body.String() {
		t.Fatal("unstable body")
	}
}
