//go:build integration

package main

import (
	"bytes"
	"context"
	"mime/multipart"
	"net/textproto"
	"strconv"
	"strings"
	"testing"

	sitesapp "github.com/aldrichcode45/peopleflow-vacantes/internal/features/companysites/application"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companysites/testsupport/mp4fixture"
	"github.com/google/uuid"
)

// siteVideoUpload posts kind=hero_video with an MP4 part named name.
func siteVideoUpload(t *testing.T, h *draftFlowHarness, token, name, contentType string, data []byte) draftFlowResponse {
	t.Helper()
	var body bytes.Buffer
	w := multipart.NewWriter(&body)
	if err := w.WriteField("kind", "hero_video"); err != nil {
		t.Fatal(err)
	}
	header := textproto.MIMEHeader{}
	header.Set("Content-Disposition", `form-data; name="file"; filename="`+name+`"`)
	header.Set("Content-Type", contentType)
	f, err := w.CreatePart(header)
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

// siteVideoRanges checks the public route's Range answers for one stored video.
func siteVideoRanges(t *testing.T, h *draftFlowHarness, url string, data []byte) {
	t.Helper()
	size := len(data)
	for _, tc := range []struct {
		name, header string
		status       int
		from, to     int // inclusive byte range expected in the body
	}{
		{"no range", "", 200, 0, size - 1},
		{"single", "bytes=0-99", 206, 0, 99},
		{"open ended", "bytes=" + strconv.Itoa(size-10) + "-", 206, size - 10, size - 1},
		{"suffix", "bytes=-32", 206, size - 32, size - 1},
	} {
		headers := map[string]string{}
		if tc.header != "" {
			headers["Range"] = tc.header
		}
		r := h.do(t, "GET", url, "", "", headers)
		if r.status != tc.status || !bytes.Equal(r.body, data[tc.from:tc.to+1]) {
			t.Fatalf("%s: %d (%d bytes)", tc.name, r.status, len(r.body))
		}
		want := map[string]string{"Content-Type": "video/mp4", "Content-Length": strconv.Itoa(tc.to - tc.from + 1), "Accept-Ranges": "bytes", "Cache-Control": "public, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox", "Content-Range": ""}
		if tc.status == 206 {
			want["Content-Range"] = "bytes " + strconv.Itoa(tc.from) + "-" + strconv.Itoa(tc.to) + "/" + strconv.Itoa(size)
		}
		for key, value := range want {
			if got := r.header.Get(key); got != value {
				t.Fatalf("%s: %s=%q want %q", tc.name, key, got, value)
			}
		}
	}
	r := h.do(t, "GET", url, "", "", map[string]string{"Range": "bytes=" + strconv.Itoa(size) + "-"})
	if r.status != 416 || len(r.body) != 0 || r.header.Get("Content-Range") != "bytes */"+strconv.Itoa(size) || r.header.Get("Cache-Control") != "no-store" {
		t.Fatalf("unsatisfiable: %d %q %v", r.status, r.body, r.header)
	}
}

// Slice B through the production router, Postgres and disk media: hero video
// upload (real MP4 boxes, no ffmpeg), every rejection without rows, the stored
// row, draft/publish with background_loop, the public read and Range serving.
func TestCompanySiteHeroVideoFlow(t *testing.T) {
	h := newCompanySiteFlowHarness(t)
	company, user, sub := draftFlowNewPrincipal(t, h.pool, "active")
	siteFlowCleanup(t, h, company.companyID)
	owner := h.actor(t, user, sub)
	other, otherUser, otherSub := draftFlowNewPrincipal(t, h.pool, "active")
	siteFlowCleanup(t, h, other.companyID)
	otherActor := h.actor(t, otherUser, otherSub)
	ctx := context.Background()
	if _, err := h.pool.Exec(ctx, `UPDATE companies SET rfc=upper(right(replace(id::text,'-',''),12)),logo_url='https://example.test/logo.png' WHERE id=$1`, company.companyID); err != nil {
		t.Fatal(err)
	}
	const path = "/v2/me/company/site"
	first := h.do(t, "GET", path, "", owner.token, nil)
	siteFlowDraft(t, first)
	if strings.Contains(string(first.body), "background_video") {
		t.Fatal("default document gained background_video")
	}

	// Rejections: nothing stored.
	valid := mp4fixture.Build(mp4fixture.Options{MoovLast: true, Width: 1920, Height: 1080, Duration: 12500, MdatBytes: 4096})
	for _, tc := range []struct {
		name, file, contentType string
		data                    []byte
		status                  int
		body                    string
	}{
		{"mov", "clip.mov", "video/quicktime", valid, 415, `{"error":"unsupported media type","code":"unsupported_media_type"}`},
		{"quicktime brand", "clip.mp4", "video/mp4", mp4fixture.Build(mp4fixture.Options{Brand: "qt  "}), 415, `{"error":"unsupported media type","code":"unsupported_media_type"}`},
		{"too long", "clip.mp4", "video/mp4", mp4fixture.Build(mp4fixture.Options{Version1: true, Timescale: 90000, Duration: 90000 * 31}), 422, `{"error":"video too long","code":"video_too_long","data":{"max_ms":30000,"duration_ms":31000}}`},
		{"no moov", "clip.mp4", "video/mp4", append(mp4fixture.Ftyp("isom"), mp4fixture.Box("mdat", make([]byte, 64))...), 422, `{"error":"video invalid","code":"video_invalid"}`},
		{"too large", "clip.mp4", "video/mp4", make([]byte, sitesapp.MaxVideoBytes+1), 413, `{"error":"payload too large","code":"payload_too_large"}`},
	} {
		r := siteVideoUpload(t, h, owner.token, tc.file, tc.contentType, tc.data)
		if r.status != tc.status || strings.TrimSpace(string(r.body)) != tc.body {
			t.Fatalf("%s: %d %s", tc.name, r.status, r.body)
		}
		draftFlowAssertNoStore(t, r)
	}
	if n := draftFlowCount(t, h.pool, `SELECT count(*) FROM company_site_media WHERE company_id=$1`, company.companyID); n != 0 {
		t.Fatal("rejected video wrote a row", n)
	}

	upload := siteVideoUpload(t, h, owner.token, "clip.mp4", "video/mp4", valid)
	if upload.status != 201 {
		t.Fatalf("%d %s", upload.status, upload.body)
	}
	draftFlowAssertNoStore(t, upload)
	m := draftFlowObject(t, upload.body)
	videoID := m["id"].(string)
	url := "/v2/company-sites/media/" + videoID
	if len(m) != 7 || m["kind"] != "hero_video" || m["content_type"] != "video/mp4" || m["width"] != float64(1920) || m["height"] != float64(1080) || m["duration_ms"] != float64(12500) || m["url"] != url {
		t.Fatal(m)
	}
	var kind, contentType string
	var width, height *int
	var duration *int
	var size int64
	if err := h.pool.QueryRow(ctx, `SELECT kind,content_type,width,height,duration_ms,byte_size FROM company_site_media WHERE id=$1`, videoID).Scan(&kind, &contentType, &width, &height, &duration, &size); err != nil || kind != "hero_video" || contentType != "video/mp4" || *width != 1920 || *height != 1080 || *duration != 12500 || size != int64(len(valid)) {
		t.Fatalf("row: %s %s %v %v %v %d %v", kind, contentType, width, height, duration, size, err)
	}
	unknown := siteVideoUpload(t, h, owner.token, "plain.MP4", "application/octet-stream", mp4fixture.Build(mp4fixture.Options{NoVideo: true}))
	if u := draftFlowObject(t, unknown.body); unknown.status != 201 || u["width"] != nil || u["height"] != nil || u["duration_ms"] != float64(5000) {
		t.Fatalf("%d %s", unknown.status, unknown.body)
	}
	siteVideoRanges(t, h, url, valid)

	// Draft: background_video must be this company's hero_video.
	cover := siteV2Upload(t, h, owner.token, "cover", siteV2PNG(t, 200, 200))
	foreignVideo := siteVideoUpload(t, h, otherActor.token, "clip.mp4", "video/mp4", valid)
	if foreignVideo.status != 201 {
		t.Fatal(string(foreignVideo.body))
	}
	video := map[string]any{"media_id": videoID}
	slug := "video-" + company.companyID.String()
	hero := map[string]any{"id": uuid.NewString(), "type": "hero", "variant": "background_loop", "hidden": false, "content": map[string]any{"title": "Únete", "background_video": video}}
	doc := map[string]any{
		"slug": slug, "theme": map[string]any{"brand_color": "#0F766E", "font_pair": "modern"}, "seo": map[string]any{"title": nil, "description": nil},
		"blocks": []any{
			hero,
			map[string]any{"id": uuid.NewString(), "type": "jobs", "variant": "list", "hidden": false, "content": map[string]any{}},
			map[string]any{"id": uuid.NewString(), "type": "closing", "variant": "simple", "hidden": false, "content": map[string]any{"title": "Ven"}},
		},
	}
	content := hero["content"].(map[string]any)
	etag := first.header.Get("ETag")
	for name, ref := range map[string]any{"foreign video": map[string]any{"media_id": draftFlowObject(t, foreignVideo.body)["id"]}, "cover as video": cover} {
		content["background_video"] = ref
		bad := h.do(t, "PUT", path+"/draft", siteFlowBody(t, doc), owner.token, map[string]string{"If-Match": etag})
		draftFlowAssertError(t, bad, 400, "validation_error")
		if fields := draftFlowObject(t, bad.body)["fields"].([]any); len(fields) != 1 || fields[0].(map[string]any)["field"] != "blocks[0].content.background_video" {
			t.Fatal(name, string(bad.body))
		}
	}
	content["background_video"] = video
	saved := h.do(t, "PUT", path+"/draft", siteFlowBody(t, doc), owner.token, map[string]string{"If-Match": etag})
	siteFlowDraft(t, saved)
	// Without the cover (poster) background_loop stays blocked.
	blocked := h.do(t, "POST", path+"/publish", "", owner.token, map[string]string{"If-Match": saved.header.Get("ETag")})
	draftFlowAssertError(t, blocked, 422, "publish_blocked")
	if got := siteFlowBody(t, map[string]any{"issues": draftFlowObject(t, blocked.body)["issues"]}); got != `{"issues":[{"code":"hero_video_missing","field":"blocks[0]"}]}` {
		t.Fatal(got)
	}
	content["cover"] = cover
	saved = h.do(t, "PUT", path+"/draft", siteFlowBody(t, doc), owner.token, map[string]string{"If-Match": saved.header.Get("ETag")})
	draft := siteFlowDraft(t, saved)
	env := draftFlowObject(t, saved.body)
	found := false
	for _, x := range env["media"].([]any) {
		if x := x.(map[string]any); x["id"] == videoID {
			found = x["kind"] == "hero_video" && x["duration_ms"] == float64(12500) && x["width"] == float64(1920)
		}
	}
	if !found {
		t.Fatal(env["media"])
	}
	siteFlowDraft(t, h.do(t, "POST", path+"/publish", "", owner.token, map[string]string{"If-Match": saved.header.Get("ETag")}))
	public := h.do(t, "GET", "/v2/company-sites/"+slug, "", "", nil)
	if public.status != 200 {
		t.Fatalf("%d %s", public.status, public.body)
	}
	pub := draftFlowObject(t, public.body)
	if got := pub["site"].(map[string]any)["blocks"].([]any)[0].(map[string]any)["content"].(map[string]any)["background_video"]; got.(map[string]any)["media_id"] != videoID {
		t.Fatal(got)
	}
	found = false
	for _, x := range pub["media"].([]any) {
		if x := x.(map[string]any); x["id"] == videoID {
			found = x["url"] == url && x["duration_ms"] == float64(12500)
		}
	}
	if !found || draft["blocks"].([]any)[0].(map[string]any)["variant"] != "background_loop" {
		t.Fatal(pub["media"])
	}
	// Removing the video again blocks a republish.
	content["background_video"] = nil
	next := h.do(t, "PUT", path+"/draft", siteFlowBody(t, doc), owner.token, map[string]string{"If-Match": saved.header.Get("ETag")})
	siteFlowDraft(t, next)
	draftFlowAssertError(t, h.do(t, "POST", path+"/publish", "", owner.token, map[string]string{"If-Match": next.header.Get("ETag")}), 422, "publish_blocked")
}

// Images keep their exact bytes and headers through the new disk adapter, and
// answer Range requests too.
func TestCompanySiteImageRangeOnDisk(t *testing.T) {
	h := newCompanySiteFlowHarness(t)
	company, user, sub := draftFlowNewPrincipal(t, h.pool, "active")
	siteFlowCleanup(t, h, company.companyID)
	owner := h.actor(t, user, sub)
	png := siteV2PNG(t, 200, 200)
	ref := siteV2Upload(t, h, owner.token, "cover", png)
	url := "/v2/company-sites/media/" + ref["media_id"].(string)
	full := h.do(t, "GET", url, "", "", nil)
	if full.status != 200 || !bytes.Equal(full.body, png) || full.header.Get("Content-Length") != strconv.Itoa(len(png)) || full.header.Get("Cache-Control") != "public, max-age=31536000, immutable" {
		t.Fatalf("%d %v", full.status, full.header)
	}
	part := h.do(t, "GET", url, "", "", map[string]string{"Range": "bytes=0-7"})
	if part.status != 206 || !bytes.Equal(part.body, png[:8]) || part.header.Get("Content-Range") != "bytes 0-7/"+strconv.Itoa(len(png)) {
		t.Fatalf("%d %v", part.status, part.header)
	}
}
