package config

import (
	"strings"
	"testing"
)

// Unconfigured storage disables only CV routes; configured roots must be private.
func TestCVStorageConfig(t *testing.T) {
	for _, tc := range []struct {
		name, value string
		bad         bool
	}{
		{"missing", "", false}, {"relative", "files", true}, {"root", "/", true}, {"nul", "/private\x00/cvs", true}, {"absolute", "/private/cvs", false},
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
			if tc.bad && strings.Contains(err.Error(), tc.value) && tc.value != "/" {
				t.Fatal("configuration error echoed the value")
			}
			if !tc.bad && cfg.Root != tc.value {
				t.Fatal(cfg)
			}
		})
	}
}
