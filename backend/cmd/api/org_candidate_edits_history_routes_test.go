package main

import (
	"encoding/base64"
	"encoding/json"
	"net/url"
	"strings"
	"testing"
	"time"

	pool "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/application/pool"
	"github.com/google/uuid"
)

func TestOrgCandidateEditsLanguageOrderNoopHTTP(t *testing.T) {
	s := newEditMemory()
	s.values["languages"] = json.RawMessage(`[{"code":"en","level":"B1"},{"code":"es","level":"native"}]`)
	headers := map[string]string{"X-Test-Sub": "sub", "X-Test-Role": routeTestRecruiterHeader, "If-Match": pool.ETag("manual", routeTestDraftID, 1)}
	w := doRouteRequest(t, orgCandidatesRouter(s), "PATCH", orgCandidatesPath+"/manual/"+routeTestDraftID.String(), `{"set":{"languages":[{"code":"es","level":"native"},{"code":"en","level":"B1"}]}}`, headers)
	if w.Code != 200 || w.Header().Get("ETag") != headers["If-Match"] || len(s.entries) != 0 {
		t.Fatal("language order must normalize before no-op detection", w.Code, w.Body.String())
	}
}

func TestOrgCandidateEditsHistoryCursorHTTP(t *testing.T) {
	s := newEditMemory()
	for i := 0; i < 51; i++ {
		s.entries = append(s.entries, pool.HistoryEntry{ID: uuid.New(), At: time.Date(2026, 1, 1, 0, 0, 51-i, 0, time.UTC), Actor: pool.Creator{ID: routeTestCompanyID}, Kind: "edit", Changes: []pool.Change{{Field: "email", Contact: true}}})
	}
	router := orgCandidatesRouter(s)
	path := orgCandidatesPath + "/manual/" + routeTestDraftID.String() + "/history"
	headers := map[string]string{"X-Test-Sub": "sub", "X-Test-Role": routeTestRecruiterHeader}
	var token string
	for _, tc := range []struct {
		name, query string
		count       int
	}{{"default", "", 20}, {"max", "?limit=50", 50}, {"one", "?limit=1", 1}} {
		t.Run(tc.name, func(t *testing.T) {
			w := doRouteRequest(t, router, "GET", path+tc.query, "", headers)
			assertDraftRouteNoStore(t, w)
			var page pool.HistoryPage
			if err := json.Unmarshal(w.Body.Bytes(), &page); err != nil {
				t.Fatal(err)
			}
			if w.Code != 200 || len(page.Items) != tc.count || page.NextCursor == nil {
				t.Fatal(w.Code, w.Body.String())
			}
			token = *page.NextCursor
		})
	}
	raw, err := base64.RawURLEncoding.DecodeString(token)
	if err != nil {
		t.Fatal(err)
	}
	var original map[string]any
	if err = json.Unmarshal(raw, &original); err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		key   string
		value any
	}{{"company", uuid.NewString()}, {"candidate", uuid.NewString()}, {"kind", "organic"}, {"v", 2}, {"at", "bad"}, {"id", uuid.Nil.String()}, {"extra", true}} {
		t.Run(tc.key, func(t *testing.T) {
			// Preserve canonical key order, so binding/position validation is
			// exercised rather than failing only on alternate JSON ordering.
			old, _ := json.Marshal(original[tc.key])
			replacement, _ := json.Marshal(tc.value)
			b := strings.Replace(string(raw), `"`+tc.key+`":`+string(old), `"`+tc.key+`":`+string(replacement), 1)
			if tc.key == "extra" {
				b = strings.TrimSuffix(string(raw), "}") + `,"extra":true}`
			}
			bad := base64.RawURLEncoding.EncodeToString([]byte(b))
			w := doRouteRequest(t, router, "GET", path+"?cursor="+url.QueryEscape(bad), "", headers)
			if w.Code != 400 || routeCatalogCode(t, w) != "invalid_cursor" {
				t.Fatal(w.Code, w.Body.String())
			}
		})
	}
	for _, bad := range []string{token + "=", token + "\n", strings.Repeat("a", pool.MaxCursorBytes+1), base64.RawURLEncoding.EncodeToString(append(raw, []byte(" {}")...)), base64.RawURLEncoding.EncodeToString(append(raw[:len(raw)-1], []byte(`,"v":1}`)...))} {
		w := doRouteRequest(t, router, "GET", path+"?cursor="+url.QueryEscape(bad), "", headers)
		if w.Code != 400 || routeCatalogCode(t, w) != "invalid_cursor" {
			t.Fatal(w.Code, w.Body.String())
		}
	}
}
