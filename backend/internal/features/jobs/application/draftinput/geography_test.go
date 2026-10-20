package draftinput

import (
	"errors"
	"strings"
	"testing"
)

func TestGeographyWholeFieldCodec(t *testing.T) {
	for _, tc := range []struct{ name, body string }{
		{"MX with postal", `{"fields":{"location":{"country":"MX","state":"14","municipality":"14039","postal_code":"44100"},"remote_scope":{"kind":"countries","countries":["CO","MX"]}}}`},
		{"anywhere", `{"fields":{"location":null,"remote_scope":{"kind":"anywhere"}}}`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			c, err := DecodeCreateV2([]byte(tc.body))
			if err != nil {
				t.Fatal(err)
			}
			if err = ValidatePersistedDraftV2(c.Fingerprint()); err != nil {
				t.Fatal(err)
			}
			p, err := DecodePatchV2([]byte(tc.body))
			if err != nil {
				t.Fatal(err)
			}
			if strings.Contains(string(p.Fingerprint()), `"title"`) {
				t.Fatal("patch filled absent fields")
			}
		})
	}
	for _, body := range []string{
		`{"fields":{"location":{"country":"MX","label":"forged"}}}`,
		`{"fields":{"remote_scope":{"kind":"anywhere","extra":true}}}`,
	} {
		if _, err := DecodePatchV2([]byte(body)); !errors.Is(err, ErrInvalidRequest) {
			t.Fatalf("unknown key: %v", err)
		}
	}
}
