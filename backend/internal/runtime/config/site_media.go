package config

import (
	"errors"
	"net/url"
	"regexp"
	"strconv"
	"strings"
)

// SiteMediaConfig deliberately contains no credentials. The AWS SDK owns their lifecycle.
type SiteMediaConfig struct {
	Mode, Bucket, Region, Prefix, Endpoint string
	ForcePathStyle                         bool
}

var siteBucketPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$`)
var siteRegionPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,62}$`)
var sitePrefixPattern = regexp.MustCompile(`^[A-Za-z0-9/_-]{0,512}$`)

// LoadSiteMediaConfig validates without echoing untrusted environment values.
func LoadSiteMediaConfig(getenv func(string) string) (SiteMediaConfig, error) {
	c := SiteMediaConfig{Mode: getenv("SITE_MEDIA_STORAGE"), Bucket: getenv("SITE_MEDIA_S3_BUCKET"), Region: getenv("SITE_MEDIA_S3_REGION"), Prefix: getenv("SITE_MEDIA_S3_PREFIX"), Endpoint: getenv("SITE_MEDIA_S3_ENDPOINT")}
	if c.Mode == "" {
		c.Mode = "disk"
	}
	if c.Mode != "disk" && c.Mode != "s3" {
		return c, errors.New("SITE_MEDIA_STORAGE must be disk or s3")
	}
	force := getenv("SITE_MEDIA_S3_FORCE_PATH_STYLE")
	if c.Mode == "disk" {
		if c.Bucket != "" || c.Region != "" || c.Prefix != "" || c.Endpoint != "" || force != "" {
			return c, errors.New("SITE_MEDIA_S3_* requires SITE_MEDIA_STORAGE=s3")
		}
		return c, nil
	}
	if !siteBucketPattern.MatchString(c.Bucket) || strings.Contains(c.Bucket, "..") {
		return c, errors.New("SITE_MEDIA_S3_BUCKET must be a valid bucket name")
	}
	if !siteRegionPattern.MatchString(c.Region) {
		return c, errors.New("SITE_MEDIA_S3_REGION is required and must be a region identifier")
	}
	if !sitePrefixPattern.MatchString(c.Prefix) || strings.HasPrefix(c.Prefix, "/") || strings.Contains(c.Prefix, "//") {
		return c, errors.New("SITE_MEDIA_S3_PREFIX must be a relative key prefix (letters, digits, slash, underscore, hyphen)")
	}
	if force != "" {
		var err error
		c.ForcePathStyle, err = strconv.ParseBool(force)
		if err != nil {
			return c, errors.New("SITE_MEDIA_S3_FORCE_PATH_STYLE must be a boolean")
		}
	}
	if c.Endpoint != "" {
		if strings.EqualFold(getenv("APP_ENV"), "production") {
			return c, errors.New("SITE_MEDIA_S3_ENDPOINT is forbidden in production")
		}
		u, err := url.Parse(c.Endpoint)
		if err != nil || u.Hostname() == "" || (u.Scheme != "http" && u.Scheme != "https") || u.User != nil || u.RawQuery != "" || u.Fragment != "" || (u.Path != "" && u.Path != "/") || u.Opaque != "" {
			return c, errors.New("SITE_MEDIA_S3_ENDPOINT must be an http(s) origin without credentials, path, query or fragment")
		}
	}
	return c, nil
}
