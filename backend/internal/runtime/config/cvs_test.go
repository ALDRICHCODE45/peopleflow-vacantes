package config

import "testing"

// Private storage must have an explicitly configured directory.
func TestCVStorageConfig(t *testing.T) {
	for _, tc := range []struct {
		name, value string
		bad         bool
	}{
		{"missing", "", true}, {"relative", "files", true}, {"root", "/", true}, {"absolute", "/private/cvs", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			cfg, err := LoadCVConfig(func(key string) string {
				if key != "CV_STORAGE_ROOT" {
					t.Fatalf("unexpected key %s", key)
				}
				return tc.value
			})
			if (err != nil) != tc.bad {
				t.Fatal(err)
			}
			if !tc.bad && cfg.Root != tc.value {
				t.Fatal(cfg)
			}
		})
	}
}
