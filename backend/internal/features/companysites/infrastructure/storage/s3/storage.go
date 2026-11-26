// Package s3 stores company site media (images and hero videos) in a private bucket.
package s3

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
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
	// stream carries the video transfers: no whole-request timeout (a ranged
	// body is read at the visitor's pace, bounded by the request context and
	// the route's write deadline), only a bound on waiting for headers.
	stream *http.Client
}

const headerTimeout = 20 * time.Second

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
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.ResponseHeaderTimeout = headerTimeout
	return &Storage{client: client, bucket: o.Bucket, prefix: strings.TrimSuffix(o.Prefix, "/"), stream: &http.Client{Transport: transport}}, nil
}
func (s *Storage) streaming(o *sdk.Options) { o.HTTPClient = s.stream }
func (s *Storage) newKey() (string, error) {
	var entropy [32]byte
	if _, err := rand.Read(entropy[:]); err != nil {
		return "", app.ErrStorageUnavailable
	}
	key := hex.EncodeToString(entropy[:])
	if s.prefix != "" {
		key = s.prefix + "/" + key
	}
	return key, nil
}
func (s *Storage) Put(ctx context.Context, data []byte) (string, error) {
	if len(data) > app.MaxMediaBytes {
		return "", app.ErrStorageUnavailable
	}
	key, err := s.newKey()
	if err != nil {
		return "", err
	}
	// No ACL: bucket remains private, including with bucket-owner-enforced ownership.
	_, err = s.client.PutObject(ctx, &sdk.PutObjectInput{Bucket: aws.String(s.bucket), Key: aws.String(key), Body: bytes.NewReader(data)})
	if err != nil {
		return "", app.ErrStorageUnavailable
	}
	return key, nil
}

// PutStream uploads a video spool (seekable, so the SDK can sign and retry it)
// of exactly size bytes, without reading it into memory.
func (s *Storage) PutStream(ctx context.Context, body io.ReadSeeker, size int64) (string, error) {
	if size < 1 || size > app.MaxVideoBytes {
		return "", app.ErrStorageUnavailable
	}
	key, err := s.newKey()
	if err != nil {
		return "", err
	}
	_, err = s.client.PutObject(ctx, &sdk.PutObjectInput{Bucket: aws.String(s.bucket), Key: aws.String(key), Body: body, ContentLength: aws.Int64(size)}, s.streaming)
	if err != nil {
		return "", app.ErrStorageUnavailable
	}
	return key, nil
}

// Open buffers one image (at most app.MaxMediaBytes) so a broken read fails
// before the route writes immutable-cache headers.
func (s *Storage) Open(ctx context.Context, key string) (io.ReadSeekCloser, error) {
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
	return nopCloser{bytes.NewReader(data)}, nil
}

type nopCloser struct{ *bytes.Reader }

func (nopCloser) Close() error { return nil }

// OpenRange returns a lazy reader over an object of the given size (from the
// database): Seek is free; Prefetch(n) or the first Read issues one ranged
// GetObject whose body is streamed, never buffered.
func (s *Storage) OpenRange(ctx context.Context, key string, size int64) (io.ReadSeekCloser, error) {
	if size < 0 || size > app.MaxVideoBytes {
		return nil, app.ErrStorageUnavailable
	}
	return &object{ctx: ctx, s: s, key: key, size: size}, nil
}

type object struct {
	ctx       context.Context
	s         *Storage
	key       string
	size, pos int64
	body      io.ReadCloser
	at, end   int64 // body covers [at, end)
	err       error
}

var _ app.Prefetcher = (*object)(nil)

func (o *object) Seek(offset int64, whence int) (int64, error) {
	switch whence {
	case io.SeekCurrent:
		offset += o.pos
	case io.SeekEnd:
		offset += o.size
	}
	if offset < 0 {
		return o.pos, errors.New("site media: negative seek")
	}
	o.pos = offset
	return offset, nil
}

// Prefetch opens [pos, pos+n) so a storage failure surfaces before the
// response status is written; after a failure every Read returns it.
func (o *object) Prefetch(n int64) error {
	if o.err == nil && n > 0 && o.pos < o.size {
		o.err = o.open(o.pos, min(o.pos+n, o.size))
	}
	return o.err
}

func (o *object) open(start, end int64) error {
	o.closeBody()
	out, err := o.s.client.GetObject(o.ctx, &sdk.GetObjectInput{Bucket: aws.String(o.s.bucket), Key: aws.String(o.key), Range: aws.String(fmt.Sprintf("bytes=%d-%d", start, end-1))}, o.s.streaming)
	if err != nil {
		return storageError(err)
	}
	if out.ContentLength != nil && *out.ContentLength != end-start {
		_ = out.Body.Close()
		return app.ErrStorageUnavailable
	}
	o.body, o.at, o.end = out.Body, start, end
	return nil
}

func (o *object) Read(p []byte) (int, error) {
	if o.err != nil {
		return 0, o.err
	}
	if o.pos >= o.size {
		return 0, io.EOF
	}
	if o.body == nil || o.at != o.pos || o.at >= o.end {
		if o.err = o.open(o.pos, o.size); o.err != nil {
			return 0, o.err
		}
	}
	if int64(len(p)) > o.end-o.at {
		p = p[:o.end-o.at]
	}
	n, err := o.body.Read(p)
	o.at += int64(n)
	o.pos += int64(n)
	switch {
	case err == io.EOF && o.at < o.end, err != nil && err != io.EOF:
		o.err = app.ErrStorageUnavailable
		return n, o.err
	case err == io.EOF:
		o.closeBody()
	}
	return n, nil
}

func (o *object) closeBody() {
	if o.body != nil {
		_ = o.body.Close()
		o.body = nil
	}
}

func (o *object) Close() error {
	o.closeBody()
	return nil
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
