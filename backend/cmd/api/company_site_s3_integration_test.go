//go:build integration

package main

import (
	"bytes"
	"context"
	"errors"
	"image"
	"image/png"
	"net/http"
	"net/http/httptest"
	"os"
	"reflect"
	"strconv"
	"testing"

	sitesapp "github.com/aldrichcode45/peopleflow-vacantes/internal/features/companysites/application"
	sitess3 "github.com/aldrichcode45/peopleflow-vacantes/internal/features/companysites/infrastructure/storage/s3"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companysites/infrastructure/storage/s3/testsupport"
	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	sdk "github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/smithy-go"
	"github.com/aws/smithy-go/logging"
	"github.com/google/uuid"
)

func requireSiteS3Endpoint(t *testing.T) string {
	t.Helper()
	endpoint := os.Getenv("SITE_MEDIA_S3_TEST_ENDPOINT")
	if err := testsupport.ValidateEndpoint(os.Getenv("APP_ENV"), endpoint); err != nil {
		t.Fatal(err)
	}
	if endpoint == "" {
		t.Skip("SITE_MEDIA_S3_TEST_ENDPOINT is not set")
	}
	return endpoint
}

func TestCompanySiteS3NetworkError(t *testing.T) {
	requireSiteS3Endpoint(t)
	server := httptest.NewServer(http.NotFoundHandler())
	endpoint := server.URL
	server.Close()
	storage, err := sitess3.New(context.Background(), sitess3.Options{Bucket: "private-bucket", Region: "us-east-1", Endpoint: endpoint, ForcePathStyle: true})
	if err != nil {
		t.Fatal(err)
	}
	h, _ := newCompanySiteFlowStorageHarness(t, storage)
	a, id, sub := draftFlowNewPrincipal(t, h.pool, "active")
	siteFlowCleanup(t, h, a.companyID)
	actor := h.actor(t, id, sub)
	var imageBytes bytes.Buffer
	if err := png.Encode(&imageBytes, image.NewRGBA(image.Rect(0, 0, 200, 200))); err != nil {
		t.Fatal(err)
	}
	response := siteUpload(t, h, actor.token, "cover", imageBytes.Bytes())
	draftFlowAssertCatalogError(t, response, 500, "internal_error")
	draftFlowAssertNoStore(t, response)
	if n := draftFlowCount(t, h.pool, `SELECT count(*) FROM company_site_media WHERE company_id=$1`, a.companyID); n != 0 {
		t.Fatal("failed storage upload wrote metadata")
	}
	mediaID := uuid.NewString()
	_, err = h.pool.Exec(context.Background(), `INSERT INTO company_site_media(id,company_id,kind,storage_key,content_type,width,height,byte_size,created_by) VALUES($1,$2,'cover','private-key','image/png',200,200,100,$3)`, mediaID, a.companyID, id)
	if err != nil {
		t.Fatal(err)
	}
	response = h.do(t, "GET", "/v2/company-sites/media/"+mediaID, "", "", nil)
	draftFlowAssertCatalogError(t, response, 500, "internal_error")
	draftFlowAssertNoStore(t, response)
}

func TestCompanySiteS3PublicMedia(t *testing.T) {
	endpoint := requireSiteS3Endpoint(t)
	ctx := context.Background()
	cfg, err := awsconfig.LoadDefaultConfig(ctx, awsconfig.WithRegion("us-east-1"), awsconfig.WithLogger(logging.Nop{}))
	if err != nil {
		t.Fatal("load test SDK configuration")
	}
	client := sdk.NewFromConfig(cfg, func(o *sdk.Options) { o.BaseEndpoint = aws.String(endpoint); o.UsePathStyle = true })
	_, err = client.CreateBucket(ctx, &sdk.CreateBucketInput{Bucket: aws.String("site-media")})
	var api smithy.APIError
	if err != nil && !(errors.As(err, &api) && api.ErrorCode() == "BucketAlreadyOwnedByYou") {
		t.Fatal("bootstrap private test bucket")
	}
	storage, err := sitess3.New(ctx, sitess3.Options{Bucket: "site-media", Region: "us-east-1", Prefix: "router-tests/" + uuid.NewString(), Endpoint: endpoint, ForcePathStyle: true})
	if err != nil {
		t.Fatal(err)
	}
	h, _ := newCompanySiteFlowStorageHarness(t, storage)
	a, id, sub := draftFlowNewPrincipal(t, h.pool, "active")
	siteFlowCleanup(t, h, a.companyID)
	actor := h.actor(t, id, sub)
	var imageBytes bytes.Buffer
	if err := png.Encode(&imageBytes, image.NewRGBA(image.Rect(0, 0, 200, 200))); err != nil {
		t.Fatal(err)
	}
	upload := siteUpload(t, h, actor.token, "cover", imageBytes.Bytes())
	if upload.status != 201 {
		t.Fatalf("%d %s", upload.status, upload.body)
	}
	m := draftFlowObject(t, upload.body)
	var storageKey string
	if err := h.pool.QueryRow(ctx, `SELECT storage_key FROM company_site_media WHERE id=$1`, m["id"]).Scan(&storageKey); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := storage.Delete(context.Background(), storageKey); err != nil {
			t.Error(err)
		}
	})
	// Object metadata is not the public Content-Type authority: the DB is.
	head, err := client.HeadObject(ctx, &sdk.HeadObjectInput{Bucket: aws.String("site-media"), Key: aws.String(storageKey)})
	if err != nil || head.ContentLength == nil || *head.ContentLength != int64(imageBytes.Len()) {
		t.Fatal("S3 head mismatch")
	}
	url := m["url"].(string)
	public := h.do(t, "GET", url, "", "", nil)
	if public.status != 200 || !bytes.Equal(public.body, imageBytes.Bytes()) {
		t.Fatalf("%d %s", public.status, public.body)
	}
	for key, want := range map[string]string{"Content-Type": "image/png", "Content-Length": strconv.Itoa(imageBytes.Len()), "Cache-Control": "public, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox"} {
		if public.header.Get(key) != want {
			t.Fatalf("%s=%q want %q", key, public.header.Get(key), want)
		}
	}
	missing := h.do(t, "GET", "/v2/company-sites/media/"+uuid.NewString(), "", "", nil)
	draftFlowAssertCatalogError(t, missing, 404, "not_found")
	draftFlowAssertNoStore(t, missing)
	if err := storage.Delete(ctx, storageKey); err != nil {
		t.Fatal(err)
	}
	missing = h.do(t, "GET", url, "", "", nil)
	draftFlowAssertCatalogError(t, missing, 404, "not_found")
	draftFlowAssertNoStore(t, missing)
	if _, err := storage.Open(ctx, storageKey); err != sitesapp.ErrMediaNotFound {
		t.Fatal(err)
	}
	// A real deleted local file, with its DB row retained, must match S3's
	// missing-object response. CV storage itself is deliberately unchanged.
	diskHarness, disk := newCompanySiteFlowStorageHarness(t)
	diskCompany, diskID, diskSub := draftFlowNewPrincipal(t, diskHarness.pool, "active")
	siteFlowCleanup(t, diskHarness, diskCompany.companyID)
	diskActor := diskHarness.actor(t, diskID, diskSub)
	diskUpload := siteUpload(t, diskHarness, diskActor.token, "cover", imageBytes.Bytes())
	if diskUpload.status != 201 {
		t.Fatalf("disk upload: %d %s", diskUpload.status, diskUpload.body)
	}
	diskMedia := draftFlowObject(t, diskUpload.body)
	var diskKey string
	if err := diskHarness.pool.QueryRow(ctx, `SELECT storage_key FROM company_site_media WHERE id=$1`, diskMedia["id"]).Scan(&diskKey); err != nil {
		t.Fatal(err)
	}
	if err := disk.Delete(ctx, diskKey); err != nil {
		t.Fatal(err)
	}
	diskMissing := diskHarness.do(t, "GET", diskMedia["url"].(string), "", "", nil)
	draftFlowAssertCatalogError(t, diskMissing, 404, "not_found")
	draftFlowAssertNoStore(t, diskMissing)
	// Date is transport-generated wall time, not a media-response header.
	diskMissing.header.Del("Date")
	missing.header.Del("Date")
	if !bytes.Equal(diskMissing.body, missing.body) || !reflect.DeepEqual(diskMissing.header, missing.header) {
		t.Fatalf("disk/S3 missing response differs: disk=%s %v S3=%s %v", diskMissing.body, diskMissing.header, missing.body, missing.header)
	}
}
