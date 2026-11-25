package http

import (
	"bytes"
	"encoding/json"
	"image"
	"image/jpeg"
	"strings"
	"testing"
)

// Kind `logo` (sections v2) is accepted at 64 px and stored with its kind; JPEG
// logos are rejected before storage; other kinds keep their 200 px floor.
func TestMediaUploadLogoKind(t *testing.T) {
	var j bytes.Buffer
	if err := jpeg.Encode(&j, image.NewRGBA(image.Rect(0, 0, 200, 200)), nil); err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		name, kind string
		data       []byte
		status     int
		code       string
	}{
		{"logo 64", "logo", testPNG(t, 64, 64), 201, ""},
		{"logo 63", "logo", testPNG(t, 64, 63), 422, "image_too_small"},
		{"logo jpeg", "logo", j.Bytes(), 415, "unsupported_media_type"},
		{"portrait 64", "portrait", testPNG(t, 64, 64), 422, "image_too_small"},
		{"uppercase kind", "LOGO", testPNG(t, 64, 64), 400, "validation_error"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s := &mediaStub{}
			h := newTestHandler(&stubStore{}).WithMedia(s, s)
			w := uploadRequest(t, h, tc.data, tc.kind, false)
			if w.Code != tc.status {
				t.Fatalf("%d %s", w.Code, w.Body)
			}
			if tc.code != "" {
				if !strings.Contains(w.Body.String(), `"code":"`+tc.code+`"`) || s.puts != 0 || s.rows != 0 {
					t.Fatalf("%s puts=%d rows=%d", w.Body, s.puts, s.rows)
				}
				return
			}
			var m map[string]any
			if err := json.Unmarshal(w.Body.Bytes(), &m); err != nil {
				t.Fatal(err)
			}
			if m["kind"] != "logo" || m["width"] != float64(64) || m["content_type"] != "image/png" || s.m.Kind != "logo" {
				t.Fatal(m)
			}
		})
	}
}
