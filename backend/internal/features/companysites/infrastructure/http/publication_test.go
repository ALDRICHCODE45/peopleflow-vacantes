package http

import (
	"encoding/json"
	"testing"

	app "github.com/aldrichcode45/peopleflow-vacantes/internal/features/companysites/application"
)

func TestPublish(t *testing.T) {
	h := newTestHandler(&stubStore{})
	value, err := h.decode(app.DefaultDocument())
	if err != nil {
		t.Fatal(err)
	}
	doc, fields := h.validator.ValidateDocument(value)
	if len(fields) > 0 {
		t.Fatal(fields)
	}
	issues := app.PublishIssues(doc, false, false)
	for _, tt := range []struct {
		match  string
		err    error
		status int
		body   string
	}{
		{"", nil, 428, "{\"error\":\"precondition required\",\"code\":\"precondition_required\"}\n"},
		{"*", nil, 400, ""}, {`W/"1"`, nil, 400, ""}, {`"0"`, nil, 400, ""}, {`"9223372036854775808"`, nil, 400, ""},
		{`"1"`, &app.PublishBlocked{Issues: issues}, 422, "{\"error\":\"site publication blocked\",\"code\":\"publish_blocked\",\"issues\":[{\"code\":\"slug_missing\",\"field\":\"slug\"},{\"code\":\"hero_title_missing\",\"field\":\"blocks[0]\"},{\"code\":\"no_content_block\",\"field\":null},{\"code\":\"company_logo_missing\",\"field\":null},{\"code\":\"company_name_missing\",\"field\":null}]}\n"},
		{`"1"`, app.ErrVersionConflict, 412, ""}, {`"1"`, nil, 200, ""},
	} {
		s := &stubStore{current: app.Current{Draft: app.DefaultDocument(), DraftVersion: 7, Media: []app.Media{}}, saveErr: tt.err}
		w := call(t, newTestHandler(s).Publish, "", tt.match)
		if w.Code != tt.status {
			t.Fatalf("%d %s", w.Code, w.Body)
		}
		if tt.body != "" && w.Body.String() != tt.body {
			t.Fatalf("%s", w.Body)
		}
		if tt.status == 400 || tt.status == 428 {
			if s.calls != 0 {
				t.Fatal("precondition reached store")
			}
		}
		if tt.status == 412 {
			var envelope map[string]json.RawMessage
			if err := json.Unmarshal(w.Body.Bytes(), &envelope); err != nil {
				t.Fatal(err)
			}
			raw, _ := json.Marshal(s.current)
			if len(envelope) != 3 || string(envelope["current"]) != string(raw) || w.Header().Get("ETag") != `"7"` {
				t.Fatal(w.Body)
			}
		}
	}
}
