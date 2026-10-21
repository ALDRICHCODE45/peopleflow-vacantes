package languages

import "testing"

func TestCodeForLegacyName(t *testing.T) {
	for _, item := range All() {
		if got, ok := CodeForLegacyName(item.Name); !ok || got != item.Code {
			t.Errorf("%s: %q %v", item.Name, got, ok)
		}
	}
	for _, tc := range []struct{ name, code string }{
		{"ESPAÑOL", "es"}, {"Espanol", "es"}, {"espan\u0303ol", "es"}, {"INGLES", "en"}, {"English", "en"}, {"French", "fr"}, {"German", "de"}, {"Italian", "it"}, {"Portuguese", "pt"}, {"Chinese", "zh"}, {"Japanese", "ja"}, {"Korean", "ko"}, {"Russian", "ru"}, {"Arabic", "ar"}, {"not in catalog", ""}, {" en ", ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got, ok := CodeForLegacyName(tc.name)
			if got != tc.code || ok != (tc.code != "") {
				t.Fatalf("%q %v", got, ok)
			}
		})
	}
}
