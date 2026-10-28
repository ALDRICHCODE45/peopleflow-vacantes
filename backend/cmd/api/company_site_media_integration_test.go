//go:build integration

package main

import (
	"bytes"
	"context"
	"errors"
	"image"
	"image/png"
	"io"
	"mime/multipart"

	sitesapp "github.com/aldrichcode45/peopleflow-vacantes/internal/features/companysites/application"
	sitespostgres "github.com/aldrichcode45/peopleflow-vacantes/internal/features/companysites/infrastructure/postgres"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/draftjson"
	"strconv"
	"testing"

	"github.com/google/uuid"
)

type siteCompensationStorage struct{ put, deleted bool }

func (s *siteCompensationStorage) Put(context.Context, []byte) (string, error) {
	s.put = true
	return "test-key", nil
}
func (s *siteCompensationStorage) Delete(ctx context.Context, key string) error {
	s.deleted = ctx.Err() == nil && key == "test-key"
	return nil
}
func (s *siteCompensationStorage) Open(context.Context, string) (io.ReadCloser, error) {
	return nil, errors.New("not used")
}
func TestCompanySiteMediaInsertCompensates(t *testing.T) {
	h := newCompanySiteFlowHarness(t)
	a, id, sub := draftFlowNewPrincipal(t, h.pool, "active")
	siteFlowCleanup(t, h, a.companyID)
	actor := h.actor(t, id, sub)
	siteFlowDraft(t, h.do(t, "GET", "/v2/me/company/site", "", actor.token, nil))
	store := sitespostgres.New(h.pool, draftjson.Decode, companySiteValidator(), nil, nil)
	files := &siteCompensationStorage{}
	_, err := store.InsertMedia(context.Background(), a.companyID, uuid.New(), sitesapp.StoredMedia{Media: sitesapp.Media{Kind: "cover", Width: 200, Height: 200}, ContentType: "image/png"}, []byte("test"), files)
	if err == nil || !files.put || !files.deleted {
		t.Fatalf("err=%v put=%v deleted=%v", err, files.put, files.deleted)
	}
	if n := draftFlowCount(t, h.pool, `SELECT count(*) FROM company_site_media WHERE company_id=$1`, a.companyID); n != 0 {
		t.Fatal(n)
	}
}

func siteUpload(t *testing.T, h *draftFlowHarness, token, kind string, data []byte) draftFlowResponse {
	t.Helper()
	var body bytes.Buffer
	w := multipart.NewWriter(&body)
	if err := w.WriteField("kind", kind); err != nil {
		t.Fatal(err)
	}
	f, err := w.CreateFormFile("file", "pretend.jpg")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = f.Write(data); err != nil {
		t.Fatal(err)
	}
	if err = w.Close(); err != nil {
		t.Fatal(err)
	}
	return h.do(t, "POST", "/v2/me/company/site/media", body.String(), token, map[string]string{"Content-Type": w.FormDataContentType()})
}
func TestCompanySiteMediaFlow(t *testing.T) {
	h := newCompanySiteFlowHarness(t)
	a, id, sub := draftFlowNewPrincipal(t, h.pool, "active")
	siteFlowCleanup(t, h, a.companyID)
	owner := h.actor(t, id, sub)
	b, bid, bsub := draftFlowNewPrincipal(t, h.pool, "active")
	siteFlowCleanup(t, h, b.companyID)
	other := h.actor(t, bid, bsub)
	rid, rsub := a.addUser(t, "recruiter")
	recruiter := h.actor(t, rid, rsub)
	var imageBytes bytes.Buffer
	if err := png.Encode(&imageBytes, image.NewRGBA(image.Rect(0, 0, 200, 200))); err != nil {
		t.Fatal(err)
	}
	upload := siteUpload(t, h, recruiter.token, "cover", imageBytes.Bytes())
	if upload.status != 201 {
		t.Fatalf("%d %s", upload.status, upload.body)
	}
	draftFlowAssertNoStore(t, upload)
	m := draftFlowObject(t, upload.body)
	mediaID := m["id"].(string)
	url := m["url"].(string)
	if m["content_type"] != "image/png" || m["width"] != float64(200) || m["height"] != float64(200) || url != "/v2/company-sites/media/"+mediaID {
		t.Fatal(m)
	}
	const path = "/v2/me/company/site"
	for _, actor := range []draftFlowActor{owner, other} {
		first := h.do(t, "GET", path, "", actor.token, nil)
		doc := siteFlowDraft(t, first)
		doc["blocks"].([]any)[0].(map[string]any)["content"].(map[string]any)["cover"] = map[string]any{"media_id": mediaID}
		saved := h.do(t, "PUT", path+"/draft", siteFlowBody(t, doc), actor.token, map[string]string{"If-Match": first.header.Get("ETag")})
		if actor.userID == owner.userID {
			siteFlowDraft(t, saved)
		} else {
			draftFlowAssertError(t, saved, 400, "validation_error")
		}
	}
	portrait := siteUpload(t, h, owner.token, "portrait", imageBytes.Bytes())
	if portrait.status != 201 {
		t.Fatal(string(portrait.body))
	}
	docResp := h.do(t, "GET", path, "", owner.token, nil)
	doc := siteFlowDraft(t, docResp)
	doc["blocks"].([]any)[0].(map[string]any)["content"].(map[string]any)["cover"] = map[string]any{"media_id": draftFlowObject(t, portrait.body)["id"]}
	wrong := h.do(t, "PUT", path+"/draft", siteFlowBody(t, doc), owner.token, map[string]string{"If-Match": docResp.header.Get("ETag")})
	draftFlowAssertError(t, wrong, 400, "validation_error")
	public := h.do(t, "GET", url, "", "", nil)
	if public.status != 200 || !bytes.Equal(public.body, imageBytes.Bytes()) {
		t.Fatalf("%d %s", public.status, public.body)
	}
	for key, want := range map[string]string{"Content-Type": "image/png", "Content-Length": strconv.Itoa(imageBytes.Len()), "Cache-Control": "public, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox"} {
		if public.header.Get(key) != want {
			t.Fatalf("%s: %s", key, public.header)
		}
	}
	for _, key := range []string{uuid.NewString(), "invalid"} {
		missing := h.do(t, "GET", "/v2/company-sites/media/"+key, "", "", nil)
		draftFlowAssertCatalogError(t, missing, 404, "not_found")
		if missing.header.Get("Cache-Control") != "no-store" {
			t.Fatal(missing.header)
		}
	}
	// Seed the remaining quota; the next insert must not escape the company lock/count transaction.
	_, err := h.pool.Exec(context.Background(), `INSERT INTO company_site_media(id,company_id,kind,storage_key,content_type,width,height,byte_size,created_by) SELECT gen_random_uuid(),$1,'cover','fixture','image/png',200,200,1,$2 FROM generate_series(1,298)`, a.companyID, id)
	if err != nil {
		t.Fatal(err)
	}
	limited := siteUpload(t, h, owner.token, "cover", imageBytes.Bytes())
	draftFlowAssertError(t, limited, 422, "media_limit_reached")
	if n := draftFlowCount(t, h.pool, `SELECT count(*) FROM company_site_media WHERE company_id=$1`, a.companyID); n != 300 {
		t.Fatal(n)
	}
}
