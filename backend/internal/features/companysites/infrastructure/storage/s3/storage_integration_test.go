//go:build integration

package s3

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	app "github.com/aldrichcode45/peopleflow-vacantes/internal/features/companysites/application"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companysites/infrastructure/storage/s3/testsupport"
	"github.com/aws/aws-sdk-go-v2/aws"
	sdk "github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/smithy-go"
	"github.com/google/uuid"
)

// minioStorage bootstraps only an explicitly opted-in local/integration endpoint.
// No policy or ACL is installed; CreateBucket's default is private.
func minioStorage(t *testing.T) *Storage {
	t.Helper()
	endpoint := os.Getenv("SITE_MEDIA_S3_TEST_ENDPOINT")
	if err := testsupport.ValidateEndpoint(os.Getenv("APP_ENV"), endpoint); err != nil {
		t.Fatal(err)
	}
	if endpoint == "" {
		t.Skip("SITE_MEDIA_S3_TEST_ENDPOINT is not set")
	}
	s, err := New(context.Background(), Options{Bucket: "site-media", Region: "us-east-1", Prefix: "integration/" + uuid.NewString(), Endpoint: endpoint, ForcePathStyle: true})
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
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	for _, size := range []int{128, app.MaxMediaBytes - 1} {
		t.Run(stringSize(size), func(t *testing.T) {
			data := bytes.Repeat([]byte{0x37}, size)
			key, err := s.Put(ctx, data)
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() {
				if err := s.Delete(context.Background(), key); err != nil {
					t.Error(err)
				}
			})
			head, err := s.client.HeadObject(ctx, &sdk.HeadObjectInput{Bucket: aws.String(s.bucket), Key: aws.String(key)})
			if err != nil || head.ContentLength == nil || *head.ContentLength != int64(size) {
				t.Fatal("head length mismatch")
			}
			body, err := s.Open(ctx, key)
			if err != nil {
				t.Fatal(err)
			}
			got, err := io.ReadAll(body)
			body.Close()
			if err != nil || !bytes.Equal(got, data) {
				t.Fatal("bytes changed")
			}
			response, err := http.Get(os.Getenv("SITE_MEDIA_S3_TEST_ENDPOINT") + "/site-media/" + key)
			if err != nil {
				t.Fatal(err)
			}
			response.Body.Close()
			if response.StatusCode != 403 {
				t.Fatalf("anonymous object access: %d", response.StatusCode)
			}
			if err := s.Delete(ctx, key); err != nil {
				t.Fatal(err)
			}
			if _, err := s.Open(ctx, key); err != app.ErrMediaNotFound {
				t.Fatal(err)
			}
		})
	}
	if _, err := s.Open(ctx, "integration/"+uuid.NewString()); err != app.ErrMediaNotFound {
		t.Fatal(err)
	}
	// Use a genuinely closed endpoint, not a cancelled context.
	server := httptest.NewServer(http.NotFoundHandler())
	endpoint := server.URL
	server.Close()
	broken, err := New(ctx, Options{Bucket: "site-media", Region: "us-east-1", Endpoint: endpoint, ForcePathStyle: true})
	if err != nil {
		t.Fatal(err)
	}
	_, put := broken.Put(ctx, []byte("image"))
	_, get := broken.Open(ctx, "private-key")
	del := broken.Delete(ctx, "private-key")
	for _, err := range []error{put, get, del} {
		if err != app.ErrStorageUnavailable || errors.Unwrap(err) != nil {
			t.Fatalf("provider error escaped: %v", err)
		}
	}
}
func stringSize(n int) string {
	if n > 1024 {
		return "near_5MiB"
	}
	return "small"
}
