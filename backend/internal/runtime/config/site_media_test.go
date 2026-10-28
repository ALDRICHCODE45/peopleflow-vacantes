package config

import (
	"strings"
	"testing"
)

func TestLoadSiteMediaConfig(t *testing.T) {
	tests := []struct {
		name    string
		env     map[string]string
		invalid bool
	}{
		{"default", nil, false},
		{"disk", map[string]string{"SITE_MEDIA_STORAGE": "disk"}, false},
		{"production s3 defaults", map[string]string{"SITE_MEDIA_STORAGE": "s3", "SITE_MEDIA_S3_BUCKET": "site-images", "SITE_MEDIA_S3_REGION": "us-east-1", "APP_ENV": "production"}, false},
		{"explicit false", map[string]string{"SITE_MEDIA_STORAGE": "s3", "SITE_MEDIA_S3_BUCKET": "site-images", "SITE_MEDIA_S3_REGION": "us-east-1", "SITE_MEDIA_S3_FORCE_PATH_STYLE": "false"}, false},
		{"s3", map[string]string{"SITE_MEDIA_STORAGE": "s3", "SITE_MEDIA_S3_BUCKET": "site-images", "SITE_MEDIA_S3_REGION": "us-east-1", "SITE_MEDIA_S3_PREFIX": "sites/v1/", "SITE_MEDIA_S3_FORCE_PATH_STYLE": "true", "SITE_MEDIA_S3_ENDPOINT": "http://127.0.0.1:19000"}, false},
		{"mode", map[string]string{"SITE_MEDIA_STORAGE": "S3"}, true},
	}
	for _, key := range []string{"BUCKET", "REGION", "PREFIX", "ENDPOINT", "FORCE_PATH_STYLE"} {
		tests = append(tests, struct {
			name    string
			env     map[string]string
			invalid bool
		}{"disk rejects " + key, map[string]string{"SITE_MEDIA_S3_" + key: "x"}, true})
	}
	for _, tc := range []struct{ name, key, value string }{
		{"missing bucket", "BUCKET", ""}, {"invalid bucket", "BUCKET", "SECRET/value"}, {"missing region", "REGION", ""}, {"invalid region", "REGION", "secret/region"},
		{"absolute prefix", "PREFIX", "/sites"}, {"traversal prefix", "PREFIX", "../sites"}, {"double slash", "PREFIX", "sites//images"}, {"invalid prefix", "PREFIX", "secret?x"},
		{"bool", "FORCE_PATH_STYLE", "maybe"}, {"endpoint scheme", "ENDPOINT", "file:///secret"}, {"endpoint credentials", "ENDPOINT", "http://secret:secret@localhost"},
		{"endpoint query", "ENDPOINT", "http://localhost?secret"}, {"endpoint fragment", "ENDPOINT", "http://localhost#secret"}, {"endpoint path", "ENDPOINT", "http://localhost/secret"}, {"endpoint malformed", "ENDPOINT", "://secret"},
	} {
		env := map[string]string{"SITE_MEDIA_STORAGE": "s3", "SITE_MEDIA_S3_BUCKET": "site-images", "SITE_MEDIA_S3_REGION": "us-east-1"}
		env["SITE_MEDIA_S3_"+tc.key] = tc.value
		tests = append(tests, struct {
			name    string
			env     map[string]string
			invalid bool
		}{tc.name, env, true})
	}
	tests = append(tests, struct {
		name    string
		env     map[string]string
		invalid bool
	}{"production endpoint", map[string]string{"SITE_MEDIA_STORAGE": "s3", "SITE_MEDIA_S3_BUCKET": "site-images", "SITE_MEDIA_S3_REGION": "us-east-1", "SITE_MEDIA_S3_ENDPOINT": "https://localhost", "APP_ENV": "production"}, true})
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, err := LoadSiteMediaConfig(func(key string) string { return tc.env[key] })
			if (err != nil) != tc.invalid {
				t.Fatalf("config=%+v err=%v", got, err)
			}
			if err != nil && strings.Contains(err.Error(), "secret") {
				t.Fatal("environment value leaked")
			}
			if tc.name == "default" && got.Mode != "disk" {
				t.Fatal(got)
			}
			if tc.name == "production s3 defaults" && (got.ForcePathStyle || got.Endpoint != "" || got.Prefix != "") {
				t.Fatal(got)
			}
			if tc.name == "s3" && (!got.ForcePathStyle || got.Prefix != "sites/v1/") {
				t.Fatal(got)
			}
		})
	}
}
