package config

import (
	"strings"
	"testing"
)

func docEnv(kv ...string) func(string) string {
	m := map[string]string{}
	for i := 0; i+1 < len(kv); i += 2 {
		m[kv[i]] = kv[i+1]
	}
	return func(k string) string { return m[k] }
}

func TestLoadDocumentStorageConfigValid(t *testing.T) {
	s3 := []string{"DOCUMENT_STORAGE", "s3", "DOCUMENT_S3_BUCKET", "docs-bucket", "DOCUMENT_S3_REGION", "us-east-1"}
	for _, tc := range []struct {
		name  string
		env   []string
		check func(DocumentStorageConfig) bool
	}{
		{"unset means disk without root: disabled", nil, func(c DocumentStorageConfig) bool { return c.Mode == "disk" && c.Root == "" && !c.Enabled() }},
		{"explicit disk without root: disabled", []string{"DOCUMENT_STORAGE", "disk"}, func(c DocumentStorageConfig) bool { return !c.Enabled() }},
		{"disk with root", []string{"DOCUMENT_STORAGE_ROOT", "/var/lib/peopleflow/documents/"}, func(c DocumentStorageConfig) bool {
			return c.Mode == "disk" && c.Root == "/var/lib/peopleflow/documents" && c.Enabled()
		}},
		{"disk root next to the CV root", []string{"DOCUMENT_STORAGE_ROOT", "/data/documents", "CV_STORAGE_ROOT", "/data/cvs"}, func(c DocumentStorageConfig) bool { return c.Enabled() }},
		{"s3 defaults", s3, func(c DocumentStorageConfig) bool {
			return c.Mode == "s3" && c.Prefix == "documents/v1" && !c.ForcePathStyle && c.Endpoint == "" && c.Enabled()
		}},
		{"s3 prefix trailing slash trimmed", append([]string{"DOCUMENT_S3_PREFIX", "docs/v2/"}, s3...), func(c DocumentStorageConfig) bool { return c.Prefix == "docs/v2" }},
		{"s3 minio", append([]string{"DOCUMENT_S3_ENDPOINT", "http://127.0.0.1:19000", "DOCUMENT_S3_FORCE_PATH_STYLE", "true"}, s3...), func(c DocumentStorageConfig) bool {
			return c.Endpoint == "http://127.0.0.1:19000" && c.ForcePathStyle
		}},
		{"s3 production without endpoint", append([]string{"APP_ENV", "production"}, s3...), func(c DocumentStorageConfig) bool { return c.Enabled() }},
		{"s3 shares the bucket with site media under another prefix", append([]string{"SITE_MEDIA_STORAGE", "s3", "SITE_MEDIA_S3_BUCKET", "docs-bucket", "SITE_MEDIA_S3_REGION", "us-east-1", "SITE_MEDIA_S3_PREFIX", "sites/v1"}, s3...), func(c DocumentStorageConfig) bool { return c.Enabled() }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			c, err := LoadDocumentStorageConfig(docEnv(tc.env...))
			if err != nil {
				t.Fatal(err)
			}
			if !tc.check(c) {
				t.Fatalf("unexpected config %+v", c)
			}
		})
	}
}

func TestLoadDocumentStorageConfigInvalid(t *testing.T) {
	s3 := func(kv ...string) []string {
		return append([]string{"DOCUMENT_STORAGE", "s3", "DOCUMENT_S3_BUCKET", "docs-bucket", "DOCUMENT_S3_REGION", "us-east-1"}, kv...)
	}
	for _, tc := range []struct {
		name string
		env  []string
	}{
		{"mode is case sensitive", []string{"DOCUMENT_STORAGE", "S3"}},
		{"unknown mode", []string{"DOCUMENT_STORAGE", "gcs"}},
		{"relative root", []string{"DOCUMENT_STORAGE_ROOT", "secret/docs"}},
		{"filesystem root", []string{"DOCUMENT_STORAGE_ROOT", "/"}},
		{"root with NUL", []string{"DOCUMENT_STORAGE_ROOT", "/data/\x00secret"}},
		{"root equals CV root", []string{"DOCUMENT_STORAGE_ROOT", "/data/cvs", "CV_STORAGE_ROOT", "/data/cvs"}},
		{"root equals CV root once cleaned", []string{"DOCUMENT_STORAGE_ROOT", "/data/cvs/", "CV_STORAGE_ROOT", "/data/x/../cvs"}},
		{"disk rejects bucket", []string{"DOCUMENT_S3_BUCKET", "secret"}},
		{"disk rejects region", []string{"DOCUMENT_S3_REGION", "secret"}},
		{"disk rejects prefix", []string{"DOCUMENT_S3_PREFIX", "secret"}},
		{"disk rejects endpoint", []string{"DOCUMENT_S3_ENDPOINT", "http://secret"}},
		{"disk rejects path style", []string{"DOCUMENT_S3_FORCE_PATH_STYLE", "true"}},
		{"s3 rejects root", s3("DOCUMENT_STORAGE_ROOT", "/data/secret")},
		{"missing bucket", []string{"DOCUMENT_STORAGE", "s3", "DOCUMENT_S3_REGION", "us-east-1"}},
		{"invalid bucket", s3("DOCUMENT_S3_BUCKET", "SECRET/value")},
		{"double dot bucket", s3("DOCUMENT_S3_BUCKET", "docs..secret")},
		{"missing region", []string{"DOCUMENT_STORAGE", "s3", "DOCUMENT_S3_BUCKET", "docs-bucket"}},
		{"invalid region", s3("DOCUMENT_S3_REGION", "secret/region")},
		{"absolute prefix", s3("DOCUMENT_S3_PREFIX", "/secret")},
		{"traversal prefix", s3("DOCUMENT_S3_PREFIX", "../secret")},
		{"double slash prefix", s3("DOCUMENT_S3_PREFIX", "a//secret")},
		{"invalid prefix", s3("DOCUMENT_S3_PREFIX", "secret?x")},
		{"bad bool", s3("DOCUMENT_S3_FORCE_PATH_STYLE", "maybe")},
		{"endpoint scheme", s3("DOCUMENT_S3_ENDPOINT", "file:///secret")},
		{"endpoint credentials", s3("DOCUMENT_S3_ENDPOINT", "http://secret:secret@localhost")},
		{"endpoint query", s3("DOCUMENT_S3_ENDPOINT", "http://localhost?secret")},
		{"endpoint fragment", s3("DOCUMENT_S3_ENDPOINT", "http://localhost#secret")},
		{"endpoint path", s3("DOCUMENT_S3_ENDPOINT", "http://localhost/secret")},
		{"endpoint malformed", s3("DOCUMENT_S3_ENDPOINT", "://secret")},
		{"production endpoint", s3("DOCUMENT_S3_ENDPOINT", "https://localhost", "APP_ENV", "production")},
		{"production endpoint any case", s3("DOCUMENT_S3_ENDPOINT", "http://127.0.0.1:9000", "APP_ENV", "Production")},
		{"same bucket and prefix as site media", append([]string{"SITE_MEDIA_STORAGE", "s3", "SITE_MEDIA_S3_BUCKET", "docs-bucket", "SITE_MEDIA_S3_REGION", "us-east-1", "SITE_MEDIA_S3_PREFIX", "documents/v1/"}, s3()...)},
	} {
		t.Run(tc.name, func(t *testing.T) {
			c, err := LoadDocumentStorageConfig(docEnv(tc.env...))
			if err == nil {
				t.Fatalf("accepted %+v", c)
			}
			if strings.Contains(err.Error(), "secret") {
				t.Fatalf("environment value leaked: %v", err)
			}
		})
	}
}

func TestLoadDocumentStorageConfigNeedsLookup(t *testing.T) {
	if _, err := LoadDocumentStorageConfig(nil); err == nil {
		t.Fatal("nil lookup accepted")
	}
}
