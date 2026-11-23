//go:build integration

package s3

import (
	"bytes"
	"context"
	"crypto/sha256"
	"errors"
	"io"
	"net/http"
	"os"
	"testing"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companysites/infrastructure/storage/s3/testsupport"
	documents "github.com/aldrichcode45/peopleflow-vacantes/internal/features/documents/application"
	"github.com/aws/aws-sdk-go-v2/aws"
	sdk "github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/smithy-go"
	"github.com/google/uuid"
)

// minioStorage bootstraps only an explicitly opted-in loopback endpoint (DOCUMENT_S3_TEST_ENDPOINT). No policy or ACL
// is installed; CreateBucket's default is private. The test credentials come from the SDK chain (AWS_ACCESS_KEY_ID and
// AWS_SECRET_ACCESS_KEY of the throwaway MinIO), never from the repository.
func minioStorage(t *testing.T) *Storage {
	t.Helper()
	endpoint := os.Getenv("DOCUMENT_S3_TEST_ENDPOINT")
	if err := testsupport.ValidateEndpoint(os.Getenv("APP_ENV"), endpoint); err != nil {
		t.Fatal(err)
	}
	if endpoint == "" {
		t.Skip("DOCUMENT_S3_TEST_ENDPOINT is not set")
	}
	s, err := New(context.Background(), Options{Bucket: "document-files", Region: "us-east-1", Prefix: "integration/" + uuid.NewString(), Endpoint: endpoint, ForcePathStyle: true})
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	_, err = s.client.CreateBucket(ctx, &sdk.CreateBucketInput{Bucket: aws.String(s.bucket)})
	var api smithy.APIError
	if err != nil && !(errors.As(err, &api) && api.ErrorCode() == "BucketAlreadyOwnedByYou") {
		t.Fatal("private test bucket bootstrap failed")
	}
	return s
}

// TestMinIOBootstrap is also the documented, aws-cli-free local bucket helper.
func TestMinIOBootstrap(t *testing.T) { minioStorage(t) }

func TestMinIORoundTrip(t *testing.T) {
	s := minioStorage(t)
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	for name, size := range map[string]int{"small": 128, "one part": partSize, "multipart": documents.MaxBytes - 1, "at the limit": documents.MaxBytes} {
		t.Run(name, func(t *testing.T) {
			want := sha256.New()
			stored, n, err := s.Put(ctx, &patternReader{left: size, hash: want}, documents.MaxBytes)
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() {
				if err := s.Delete(context.Background(), stored); err != nil {
					t.Error(err)
				}
			})
			if n != int64(size) {
				t.Fatalf("size=%d want %d", n, size)
			}
			head, err := s.client.HeadObject(ctx, &sdk.HeadObjectInput{Bucket: aws.String(s.bucket), Key: aws.String(s.objectKey(stored))})
			if err != nil || head.ContentLength == nil || *head.ContentLength != int64(size) {
				t.Fatal("head length mismatch")
			}
			body, err := s.Open(ctx, stored)
			if err != nil {
				t.Fatal(err)
			}
			got := sha256.New()
			copied, err := io.Copy(got, body)
			_ = body.Close()
			if err != nil || copied != int64(size) || !bytes.Equal(got.Sum(nil), want.Sum(nil)) {
				t.Fatalf("bytes changed: copied=%d err=%v", copied, err)
			}
			// The bucket is private: no anonymous read.
			response, err := http.Get(os.Getenv("DOCUMENT_S3_TEST_ENDPOINT") + "/" + s.bucket + "/" + s.objectKey(stored))
			if err != nil {
				t.Fatal(err)
			}
			response.Body.Close()
			if response.StatusCode != 403 {
				t.Fatalf("anonymous object access: %d", response.StatusCode)
			}
			if err := s.Delete(ctx, stored); err != nil {
				t.Fatal(err)
			}
			if _, err := s.Open(ctx, stored); !errors.Is(err, documents.ErrNotFound) {
				t.Fatalf("open after delete: %v", err)
			}
		})
	}
}

func TestMinIOSizeCapLeavesNothingBehind(t *testing.T) {
	s := minioStorage(t)
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	for name, size := range map[string]int{"single part": 1001, "multipart": 2*partSize + 1} {
		limit := int64(1000)
		if name == "multipart" {
			limit = 2 * partSize
		}
		if _, _, err := s.Put(ctx, &patternReader{left: size}, limit); !errors.Is(err, documents.ErrTooLarge) {
			t.Fatalf("%s: %v", name, err)
		}
	}
	objects, err := s.Objects(ctx)
	if err != nil || len(objects) != 0 {
		t.Fatalf("objects=%v err=%v", objects, err)
	}
	pending, err := s.client.ListMultipartUploads(ctx, &sdk.ListMultipartUploadsInput{Bucket: aws.String(s.bucket), Prefix: aws.String(s.prefix + "/")})
	if err != nil || len(pending.Uploads) != 0 {
		t.Fatalf("incomplete multipart uploads left: %v %v", pending, err)
	}
}

func TestMinIOObjectsAndMissingKey(t *testing.T) {
	s := minioStorage(t)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	stored, _, err := s.Put(ctx, bytes.NewReader([]byte("doc")), 10)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = s.Delete(context.Background(), stored) })
	objects, err := s.Objects(ctx)
	if err != nil || len(objects) != 1 || objects[0].Key != stored || time.Since(objects[0].ModTime) > time.Hour {
		t.Fatalf("objects=%v err=%v", objects, err)
	}
	missing := bytes.Repeat([]byte("a"), 64)
	if _, err := s.Open(ctx, string(missing)); !errors.Is(err, documents.ErrNotFound) {
		t.Fatalf("missing key: %v", err)
	}
	if err := s.Delete(ctx, string(missing)); err != nil {
		t.Fatalf("missing delete: %v", err)
	}
}
