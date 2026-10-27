package httpjson

import (
	"net/http/httptest"
	"reflect"
	"testing"
)

func TestSiteErrorCodes(t *testing.T) {
	want := []Code{"slug_taken", "slug_reserved", "publish_blocked", "site_not_found", "unsupported_media_type", "image_too_small", "image_too_large", "media_limit_reached"}
	if !reflect.DeepEqual(SiteErrorCodes(), want) {
		t.Fatal(SiteErrorCodes())
	}
	statuses := []int{409, 422, 422, 404, 415, 422, 422, 422}
	for i, code := range want {
		t.Run(string(code), func(t *testing.T) {
			def := Resolve(code)
			if def.Code != code || def.Status != statuses[i] || def.Message == "" {
				t.Fatal(def)
			}
		})
	}
	list := SiteErrorCodes()
	list[0] = "oops"
	if SiteErrorCodes()[0] != CodeSlugTaken {
		t.Fatal("mutable list")
	}
}
func TestSiteErrorEnvelopes(t *testing.T) {
	for _, tt := range []struct {
		code   Code
		status int
		body   string
	}{{CodeSlugTaken, 409, "{\"error\":\"slug taken\",\"code\":\"slug_taken\",\"field\":\"slug\"}\n"}, {CodeSlugReserved, 422, "{\"error\":\"slug reserved\",\"code\":\"slug_reserved\",\"field\":\"slug\"}\n"}, {CodeForbidden, 500, "{\"error\":\"an internal error occurred\",\"code\":\"internal_error\"}\n"}} {
		t.Run(string(tt.code), func(t *testing.T) {
			w := httptest.NewRecorder()
			WriteSiteSlugError(w, tt.code)
			if w.Code != tt.status || w.Body.String() != tt.body {
				t.Fatalf("%d %s", w.Code, w.Body)
			}
		})
	}
}
