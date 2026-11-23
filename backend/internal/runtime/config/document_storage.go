package config

import (
	"errors"
	"net/url"
	"path/filepath"
	"strconv"
	"strings"
)

// DefaultDocumentS3Prefix is the key prefix of documents when DOCUMENT_S3_PREFIX is unset. It differs from any
// site-media prefix by construction (docs/contracts/placement-vacancy-documents-v1.md, «Storage»).
const DefaultDocumentS3Prefix = "documents/v1"

// DocumentStorageConfig deliberately contains no credentials: the AWS SDK owns their lifecycle.
type DocumentStorageConfig struct {
	// Mode is "disk" or "s3".
	Mode string
	// Root is the absolute private directory (disk only). Empty with Mode "disk" means documents are disabled.
	Root string
	// Bucket, Region, Prefix, Endpoint and ForcePathStyle configure S3 (s3 only). Prefix has no trailing slash.
	Bucket, Region, Prefix, Endpoint string
	ForcePathStyle                   bool
}

// Enabled reports whether a documents storage can be built. With it false every document route answers 503
// document_storage_unavailable and the rest of the API is unaffected.
func (c DocumentStorageConfig) Enabled() bool {
	return c.Mode == "s3" || (c.Mode == "disk" && c.Root != "")
}

// LoadDocumentStorageConfig validates DOCUMENT_STORAGE and the DOCUMENT_* variables. Errors are static messages
// that never echo environment values. It also reads CV_STORAGE_ROOT, SITE_MEDIA_* and APP_ENV to refuse
// namespaces shared with CVs or site media and an S3 endpoint override in production.
func LoadDocumentStorageConfig(getenv func(string) string) (DocumentStorageConfig, error) {
	if getenv == nil {
		return DocumentStorageConfig{}, errors.New("document storage configuration lookup required")
	}
	c := DocumentStorageConfig{Mode: getenv("DOCUMENT_STORAGE")}
	if c.Mode == "" {
		c.Mode = "disk"
	}
	if c.Mode != "disk" && c.Mode != "s3" {
		return DocumentStorageConfig{}, errors.New("DOCUMENT_STORAGE must be disk or s3")
	}
	root := strings.TrimSpace(getenv("DOCUMENT_STORAGE_ROOT"))
	bucket, region, prefix, endpoint := getenv("DOCUMENT_S3_BUCKET"), getenv("DOCUMENT_S3_REGION"), getenv("DOCUMENT_S3_PREFIX"), getenv("DOCUMENT_S3_ENDPOINT")
	force := getenv("DOCUMENT_S3_FORCE_PATH_STYLE")

	if c.Mode == "disk" {
		if bucket != "" || region != "" || prefix != "" || endpoint != "" || force != "" {
			return DocumentStorageConfig{}, errors.New("DOCUMENT_S3_* requires DOCUMENT_STORAGE=s3")
		}
		if root == "" {
			return c, nil
		}
		if !filepath.IsAbs(root) || filepath.Clean(root) == string(filepath.Separator) || strings.ContainsRune(root, 0) {
			return DocumentStorageConfig{}, errors.New("DOCUMENT_STORAGE_ROOT must be an absolute private directory")
		}
		c.Root = filepath.Clean(root)
		if cv := strings.TrimSpace(getenv(EnvCVStorageRoot)); cv != "" && filepath.IsAbs(cv) && filepath.Clean(cv) == c.Root {
			return DocumentStorageConfig{}, errors.New("DOCUMENT_STORAGE_ROOT must differ from CV_STORAGE_ROOT")
		}
		return c, nil
	}

	if root != "" {
		return DocumentStorageConfig{}, errors.New("DOCUMENT_STORAGE_ROOT requires DOCUMENT_STORAGE=disk")
	}
	if !siteBucketPattern.MatchString(bucket) || strings.Contains(bucket, "..") {
		return DocumentStorageConfig{}, errors.New("DOCUMENT_S3_BUCKET must be a valid bucket name")
	}
	if !siteRegionPattern.MatchString(region) {
		return DocumentStorageConfig{}, errors.New("DOCUMENT_S3_REGION is required and must be a region identifier")
	}
	if prefix == "" {
		prefix = DefaultDocumentS3Prefix
	}
	if !sitePrefixPattern.MatchString(prefix) || strings.HasPrefix(prefix, "/") || strings.Contains(prefix, "//") {
		return DocumentStorageConfig{}, errors.New("DOCUMENT_S3_PREFIX must be a relative key prefix (letters, digits, slash, underscore, hyphen)")
	}
	prefix = strings.TrimSuffix(prefix, "/")
	if force != "" {
		var err error
		if c.ForcePathStyle, err = strconv.ParseBool(force); err != nil {
			return DocumentStorageConfig{}, errors.New("DOCUMENT_S3_FORCE_PATH_STYLE must be a boolean")
		}
	}
	if endpoint != "" {
		if strings.EqualFold(getenv("APP_ENV"), "production") {
			return DocumentStorageConfig{}, errors.New("DOCUMENT_S3_ENDPOINT is forbidden in production")
		}
		u, err := url.Parse(endpoint)
		if err != nil || u.Hostname() == "" || (u.Scheme != "http" && u.Scheme != "https") || u.User != nil || u.RawQuery != "" || u.Fragment != "" || (u.Path != "" && u.Path != "/") || u.Opaque != "" {
			return DocumentStorageConfig{}, errors.New("DOCUMENT_S3_ENDPOINT must be an http(s) origin without credentials, path, query or fragment")
		}
	}
	// Documents never share a namespace with site media.
	if getenv("SITE_MEDIA_STORAGE") == "s3" && getenv("SITE_MEDIA_S3_BUCKET") == bucket && strings.TrimSuffix(getenv("SITE_MEDIA_S3_PREFIX"), "/") == prefix {
		return DocumentStorageConfig{}, errors.New("DOCUMENT_S3_PREFIX must differ from SITE_MEDIA_S3_PREFIX in a shared bucket")
	}
	c.Bucket, c.Region, c.Prefix, c.Endpoint = bucket, region, prefix, endpoint
	return c, nil
}
