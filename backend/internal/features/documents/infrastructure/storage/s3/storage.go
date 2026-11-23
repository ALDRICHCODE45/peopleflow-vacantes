// Package s3 stores placement and vacancy documents in a private bucket under its own key prefix (D24). Uploads stream
// through the SDK upload manager and downloads hand the GetObject body to the caller; neither buffers a whole object.
package s3

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	documents "github.com/aldrichcode45/peopleflow-vacantes/internal/features/documents/application"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/feature/s3/manager"
	sdk "github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/smithy-go"
	"github.com/aws/smithy-go/logging"
)

const (
	// partSize is the smallest multipart part S3 accepts. With uploadConcurrency parts in flight a stream holds roughly
	// partSize*(uploadConcurrency+1) bytes, independent of the object size (the object is at most 10 MiB, so two parts).
	partSize          = 5 << 20
	uploadConcurrency = 2
)

// Options contains routing metadata only, never credentials.
type Options struct {
	Bucket, Region, Prefix, Endpoint string
	ForcePathStyle                   bool
}

// Storage keeps objects at <prefix>/<64 hex>. The port's key is only the 64 hex characters: the prefix is the
// adapter's private business, so the same keys work with any prefix and the database never stores one.
type Storage struct {
	client         *sdk.Client
	uploader       *manager.Uploader
	bucket, prefix string
}

var _ documents.Storage = (*Storage)(nil)

// New uses the SDK default credential chain (including IAM roles). SDK logging is disabled so request URLs,
// identifiers and credential errors cannot leak. Endpoint overrides, explicit or inherited from the environment or a
// shared profile, are forbidden in production. Like sites3.New (the site-media adapter) it never reads a static key.
func New(ctx context.Context, o Options) (*Storage, error) {
	cfg, err := config.LoadDefaultConfig(ctx, config.WithRegion(o.Region), config.WithLogger(logging.Nop{}), config.WithClientLogMode(0), config.WithHTTPClient(&http.Client{Timeout: 60 * time.Second}), config.WithRetryMaxAttempts(2))
	if err != nil {
		return nil, documents.ErrStorageUnavailable
	}
	production := strings.EqualFold(os.Getenv("APP_ENV"), "production")
	_, globalEndpointSet := os.LookupEnv("AWS_ENDPOINT_URL")
	_, serviceEndpointSet := os.LookupEnv("AWS_ENDPOINT_URL_S3")
	configuredEndpoint := cfg.BaseEndpoint != nil || globalEndpointSet || serviceEndpointSet
	// Inspect the loaded profile too, even if AWS_IGNORE_CONFIGURED_ENDPOINT_URLS disables resolution. Endpoint
	// configuration is forbidden, not just ignored, in production. Never include its value in the returned error.
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
		// NewFromConfig resolves service-specific shared/env endpoints before this callback. Observe them, then remove
		// every inherited endpoint override.
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
		return nil, errors.New("documents: configured S3 endpoints are forbidden in production")
	}
	uploader := manager.NewUploader(client, func(u *manager.Uploader) {
		u.PartSize = partSize
		u.Concurrency = uploadConcurrency
		u.LeavePartsOnError = false
	})
	return &Storage{client: client, uploader: uploader, bucket: o.Bucket, prefix: strings.TrimSuffix(o.Prefix, "/")}, nil
}

func validKey(key string) bool {
	if len(key) != 64 {
		return false
	}
	for _, c := range key {
		if !(c >= '0' && c <= '9' || c >= 'a' && c <= 'f') {
			return false
		}
	}
	return true
}

func (s *Storage) objectKey(key string) string {
	if s.prefix == "" {
		return key
	}
	return s.prefix + "/" + key
}

// Put streams r into a new random key without buffering the object: the upload manager holds at most a couple of
// 5 MiB parts. No ACL is sent, so the bucket stays private. Reading stops with documents.ErrTooLarge at maxBytes+1;
// the manager then aborts the multipart upload, so nothing becomes visible.
func (s *Storage) Put(ctx context.Context, r io.Reader, maxBytes int64) (string, int64, error) {
	if maxBytes <= 0 {
		return "", 0, errors.New("document size limit must be positive")
	}
	if err := ctx.Err(); err != nil {
		return "", 0, err
	}
	var entropy [32]byte
	if _, err := rand.Read(entropy[:]); err != nil {
		return "", 0, documents.ErrStorageUnavailable
	}
	key := hex.EncodeToString(entropy[:])
	bounded := documents.NewBoundedReader(ctx, r, maxBytes)
	_, err := s.uploader.Upload(ctx, &sdk.PutObjectInput{Bucket: aws.String(s.bucket), Key: aws.String(s.objectKey(key)), Body: bounded})
	if err != nil {
		if cause := bounded.Err(); cause != nil {
			// The caller's body, its context or the size cap failed, not the provider.
			return "", 0, cause
		}
		return "", 0, documents.ErrStorageUnavailable
	}
	return key, bounded.N(), nil
}

// Open returns the GetObject body as is: the caller streams it and must close it.
func (s *Storage) Open(ctx context.Context, key string) (io.ReadCloser, error) {
	if !validKey(key) {
		return nil, documents.ErrInvalidKey
	}
	result, err := s.client.GetObject(ctx, &sdk.GetObjectInput{Bucket: aws.String(s.bucket), Key: aws.String(s.objectKey(key))})
	if err != nil {
		return nil, storageError(err)
	}
	return result.Body, nil
}

// Delete is idempotent: S3 answers success for a missing key.
func (s *Storage) Delete(ctx context.Context, key string) error {
	if !validKey(key) {
		return documents.ErrInvalidKey
	}
	_, err := s.client.DeleteObject(ctx, &sdk.DeleteObjectInput{Bucket: aws.String(s.bucket), Key: aws.String(s.objectKey(key))})
	if err != nil {
		if errors.Is(storageError(err), documents.ErrNotFound) {
			return nil
		}
		return documents.ErrStorageUnavailable
	}
	return nil
}

// Objects pages through ListObjectsV2 under the prefix. Only direct children named by a valid key are reported, so
// Reconcile can never delete a neighbour of another namespace.
func (s *Storage) Objects(ctx context.Context) ([]documents.Object, error) {
	input := &sdk.ListObjectsV2Input{Bucket: aws.String(s.bucket)}
	if s.prefix != "" {
		input.Prefix = aws.String(s.prefix + "/")
	}
	out := []documents.Object{}
	pages := sdk.NewListObjectsV2Paginator(s.client, input)
	for pages.HasMorePages() {
		page, err := pages.NextPage(ctx)
		if err != nil {
			return nil, documents.ErrStorageUnavailable
		}
		for _, obj := range page.Contents {
			name := strings.TrimPrefix(aws.ToString(obj.Key), s.prefix+"/")
			if s.prefix == "" {
				name = aws.ToString(obj.Key)
			}
			if !validKey(name) {
				continue
			}
			out = append(out, documents.Object{Key: name, ModTime: aws.ToTime(obj.LastModified)})
		}
	}
	return out, nil
}

func storageError(err error) error {
	var api smithy.APIError
	if errors.As(err, &api) && (api.ErrorCode() == "NoSuchKey" || api.ErrorCode() == "NotFound") {
		return documents.ErrNotFound
	}
	return documents.ErrStorageUnavailable
}
