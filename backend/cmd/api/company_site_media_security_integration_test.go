//go:build integration

package main

import (
	"bytes"
	"context"
	"image"
	"image/png"
	"mime/multipart"
	"reflect"
	"sort"
	"testing"

	cvstorage "github.com/aldrichcode45/peopleflow-vacantes/internal/features/candidates/infrastructure/storage"
	sitesapp "github.com/aldrichcode45/peopleflow-vacantes/internal/features/companysites/application"
	"github.com/google/uuid"
)

func siteSecurityPNG(t *testing.T, w, h int) []byte {
	t.Helper()
	var b bytes.Buffer
	if err := png.Encode(&b, image.NewRGBA(image.Rect(0, 0, w, h))); err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}
func siteSecurityMultipart(t *testing.T, data []byte, mode string) (string, string) {
	t.Helper()
	var b bytes.Buffer
	mw := multipart.NewWriter(&b)
	if mode != "missing kind" {
		if err := mw.WriteField("kind", "cover"); err != nil {
			t.Fatal(err)
		}
	}
	f, err := mw.CreateFormFile("file", "ignored.jpg")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = f.Write(data); err != nil {
		t.Fatal(err)
	}
	if mode == "multiple files" {
		f, err = mw.CreateFormFile("file", "second.png")
		if err != nil {
			t.Fatal(err)
		}
		if _, err = f.Write(data); err != nil {
			t.Fatal(err)
		}
	}
	if mode == "unknown field" {
		if err = mw.WriteField("unknown", "value"); err != nil {
			t.Fatal(err)
		}
	}
	if err = mw.Close(); err != nil {
		t.Fatal(err)
	}
	return b.String(), mw.FormDataContentType()
}
func siteStorageKeys(t *testing.T, files *cvstorage.Local) []string {
	t.Helper()
	keys, err := files.Keys(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	sort.Strings(keys)
	return keys
}
func siteSeedMedia(t *testing.T, h *draftFlowHarness, files *cvstorage.Local, company, user uuid.UUID, n int, data []byte) {
	t.Helper()
	keys := make([]string, n)
	for i := range keys {
		key, err := files.Put(context.Background(), data)
		if err != nil {
			t.Fatal(err)
		}
		keys[i] = key
	}
	_, err := h.pool.Exec(context.Background(), `INSERT INTO company_site_media(id,company_id,kind,storage_key,content_type,width,height,byte_size,created_by) SELECT gen_random_uuid(),$1,'cover',key,'image/png',200,200,$4,$2 FROM unnest($3::text[]) AS key`, company, user, keys, len(data))
	if err != nil {
		t.Fatal(err)
	}
}
func TestCompanySiteMediaRejectionsDoNotWrite(t *testing.T) {
	h, files := newCompanySiteFlowStorageHarness(t)
	company, id, sub := draftFlowNewPrincipal(t, h.pool, "active")
	siteFlowCleanup(t, h, company.companyID)
	actor := h.actor(t, id, sub)
	valid := siteSecurityPNG(t, 200, 200)
	for _, tc := range []struct {
		name   string
		data   []byte
		status int
		code   string
	}{
		{"file cap", make([]byte, sitesapp.MaxMediaBytes+1), 413, "payload_too_large"},
		{"envelope cap", make([]byte, sitesapp.MaxMediaBytes+65536), 413, "payload_too_large"},
		{"unsupported", []byte("not an image"), 415, "unsupported_media_type"},
		{"small", siteSecurityPNG(t, 199, 200), 422, "image_too_small"},
		{"large", siteSecurityPNG(t, 6001, 200), 422, "image_too_large"},
		{"multiple files", valid, 400, "invalid_request"},
		{"unknown field", valid, 400, "invalid_request"},
		{"missing kind", valid, 400, "invalid_request"},
		{"limit", valid, 422, "media_limit_reached"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if tc.name == "limit" {
				siteSeedMedia(t, h, files, company.companyID, id, 300, valid)
			}
			before := draftFlowCount(t, h.pool, `SELECT count(*) FROM company_site_media WHERE company_id=$1`, company.companyID)
			keys := siteStorageKeys(t, files)
			body, typ := siteSecurityMultipart(t, tc.data, tc.name)
			response := h.do(t, "POST", "/v2/me/company/site/media", body, actor.token, map[string]string{"Content-Type": typ})
			draftFlowAssertError(t, response, tc.status, tc.code)
			after := draftFlowCount(t, h.pool, `SELECT count(*) FROM company_site_media WHERE company_id=$1`, company.companyID)
			if after != before || !reflect.DeepEqual(keys, siteStorageKeys(t, files)) {
				t.Fatalf("rejected request changed rows/keys: rows %d -> %d", before, after)
			}
		})
	}
}
func TestCompanySiteMediaConcurrentQuota(t *testing.T) {
	h, files := newCompanySiteFlowStorageHarness(t)
	company, id, sub := draftFlowNewPrincipal(t, h.pool, "active")
	siteFlowCleanup(t, h, company.companyID)
	actor := h.actor(t, id, sub)
	valid := siteSecurityPNG(t, 200, 200)
	siteSeedMedia(t, h, files, company.companyID, id, 299, valid)
	body, typ := siteSecurityMultipart(t, valid, "")
	type result struct {
		response draftFlowResponse
		err      error
	}
	results := make(chan result, 5)
	start := make(chan struct{})
	for i := 0; i < 5; i++ {
		go func() {
			<-start
			response, err := h.roundTrip("POST", "/v2/me/company/site/media", body, actor.token, map[string]string{"Content-Type": typ})
			results <- result{response, err}
		}()
	}
	close(start)
	created, rejected := 0, 0
	for i := 0; i < 5; i++ {
		got := <-results
		if got.err != nil {
			t.Fatal(got.err)
		}
		switch got.response.status {
		case 201:
			created++
			draftFlowAssertNoStore(t, got.response)
		case 422:
			rejected++
			draftFlowAssertError(t, got.response, 422, "media_limit_reached")
		default:
			t.Fatalf("unexpected %d %s", got.response.status, got.response.body)
		}
	}
	if created != 1 || rejected != 4 {
		t.Fatalf("created=%d rejected=%d", created, rejected)
	}
	rows, err := h.pool.Query(context.Background(), `SELECT storage_key FROM company_site_media WHERE company_id=$1`, company.companyID)
	if err != nil {
		t.Fatal(err)
	}
	var dbKeys []string
	for rows.Next() {
		var key string
		if err = rows.Scan(&key); err != nil {
			rows.Close()
			t.Fatal(err)
		}
		dbKeys = append(dbKeys, key)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		t.Fatal(err)
	}
	sort.Strings(dbKeys)
	keys := siteStorageKeys(t, files)
	if len(dbKeys) != 300 || len(keys) != 300 || !reflect.DeepEqual(dbKeys, keys) {
		t.Fatalf("storage/DB divergence: db=%d storage=%d", len(dbKeys), len(keys))
	}
}
