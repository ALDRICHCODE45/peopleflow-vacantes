// Package s3 stores only company site images in a private bucket.
package s3

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	app "github.com/aldrichcode45/peopleflow-vacantes/internal/features/companysites/application"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	sdk "github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/smithy-go"
	"github.com/aws/smithy-go/logging"
)

// Options contains routing metadata only, never credentials.
type Options struct {
	Bucket, Region, Prefix, Endpoint string
	ForcePathStyle                   bool
}
type Storage struct {
	client         *sdk.Client
	bucket, prefix string
}

var _ app.Storage = (*Storage)(nil)

// New uses the SDK default credential chain (including IAM roles). SDK logging
// is disabled so request URLs, identifiers and credential errors cannot leak.
func New(ctx context.Context, o Options) (*Storage, error) {
	cfg, err := config.LoadDefaultConfig(ctx, config.WithRegion(o.Region), config.WithLogger(logging.Nop{}), config.WithClientLogMode(0), config.WithHTTPClient(&http.Client{Timeout: 20 * time.Second}), config.WithRetryMaxAttempts(2))
	if err != nil {
		return nil, app.ErrStorageUnavailable
	}
	production := strings.EqualFold(os.Getenv("APP_ENV"), "production")
	_, globalEndpointSet := os.LookupEnv("AWS_ENDPOINT_URL")
	_, serviceEndpointSet := os.LookupEnv("AWS_ENDPOINT_URL_S3")
	configuredEndpoint := cfg.BaseEndpoint != nil || globalEndpointSet || serviceEndpointSet
	// Inspect the loaded profile too, even if AWS_IGNORE_CONFIGURED_ENDPOINT_URLS
	// disables resolution. Endpoint configuration is forbidden, not just ignored,
	// in production. Never include its value in the returned error.
	for _, source := range cfg.ConfigSources {
		if shared, ok := source.(config.SharedConfig); ok {
			configuredEndpoint = configuredEndpoint || shared.BaseEndpoint != ""
			for _, service := range shared.Services.ServiceValues {
				_, set := service["endpoint_url"]
				configuredEndpoint = configuredEndpoint || set
			}
		}
	}
	client := sdk.NewFromConfig(cfg, func(c *sdk.Options) {
		// NewFromConfig resolves service-specific shared/env endpoints before this
		// callback. Observe them, then remove all inherited endpoint overrides.
		configuredEndpoint = configuredEndpoint || c.BaseEndpoint != nil
		c.BaseEndpoint = nil
		c.EndpointResolver = nil
		c.EndpointResolverV2 = sdk.NewDefaultEndpointResolverV2()
		c.UsePathStyle = o.ForcePathStyle
		if !production && o.Endpoint != "" {
			c.BaseEndpoint = aws.String(o.Endpoint)
		}
	})
	if production && (configuredEndpoint || o.Endpoint != "") {
		return nil, errors.New("site media: configured S3 endpoints are forbidden in production")
	}
	return &Storage{client: client, bucket: o.Bucket, prefix: strings.TrimSuffix(o.Prefix, "/")}, nil
}
func (s *Storage) Put(ctx context.Context, data []byte) (string, error) {
	if len(data) > app.MaxMediaBytes {
		return "", app.ErrStorageUnavailable
	}
	var entropy [32]byte
	if _, err := rand.Read(entropy[:]); err != nil {
		return "", app.ErrStorageUnavailable
	}
	key := hex.EncodeToString(entropy[:])
	if s.prefix != "" {
		key = s.prefix + "/" + key
	}
	// No ACL: bucket remains private, including with bucket-owner-enforced ownership.
	_, err := s.client.PutObject(ctx, &sdk.PutObjectInput{Bucket: aws.String(s.bucket), Key: aws.String(key), Body: bytes.NewReader(data)})
	if err != nil {
		return "", app.ErrStorageUnavailable
	}
	return key, nil
}
func (s *Storage) Open(ctx context.Context, key string) (io.ReadCloser, error) {
	result, err := s.client.GetObject(ctx, &sdk.GetObjectInput{Bucket: aws.String(s.bucket), Key: aws.String(key)})
	if err != nil {
		return nil, storageError(err)
	}
	defer result.Body.Close()
	if result.ContentLength != nil && *result.ContentLength > app.MaxMediaBytes {
		return nil, app.ErrStorageUnavailable
	}
	// Buffer before returning so interrupted/oversized reads fail before the HTTP
	// handler writes immutable-cache headers. At most 5 MiB + one sentinel byte.
	data, err := io.ReadAll(io.LimitReader(result.Body, app.MaxMediaBytes+1))
	if err != nil || len(data) > app.MaxMediaBytes {
		return nil, app.ErrStorageUnavailable
	}
	return io.NopCloser(bytes.NewReader(data)), nil
}
func (s *Storage) Delete(ctx context.Context, key string) error {
	_, err := s.client.DeleteObject(ctx, &sdk.DeleteObjectInput{Bucket: aws.String(s.bucket), Key: aws.String(key)})
	if err != nil {
		return storageError(err)
	}
	return nil
}
func storageError(err error) error {
	var api smithy.APIError
	if errors.As(err, &api) && (api.ErrorCode() == "NoSuchKey" || api.ErrorCode() == "NotFound") {
		return app.ErrMediaNotFound
	}
	return app.ErrStorageUnavailable
}
