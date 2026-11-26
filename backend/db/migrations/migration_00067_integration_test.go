//go:build integration

// Migration 00067 (`company_site_hero_video_media`): company_site_media accepts
// the kind `hero_video` (video/mp4 only, ≤ 20 MiB, duration_ms 1..30000
// required, width/height both NULL or both 1..16384) while images keep NOT NULL
// dimensions, their pixel floors, the 5 MiB cap and a NULL duration; existing
// rows are untouched; Down refuses while any hero_video exists and otherwise
// restores the 00066 schema under the same constraint names.
package migrations_test

import (
	"context"
	"slices"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/pressly/goose/v3"
)

type videoRow struct {
	kind, contentType string
	width, height     any
	duration          any
	size              int64
}

func (s logoSeed) row(r videoRow) (uuid.UUID, error) {
	s.t.Helper()
	id := uuid.New()
	return id, s.exec(`INSERT INTO company_site_media(id,company_id,kind,storage_key,content_type,width,height,duration_ms,byte_size,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, id, s.company, r.kind, "key-"+id.String(), r.contentType, r.width, r.height, r.duration, r.size, s.actor)
}

func TestMigration00067UpReachesVersion67(t *testing.T) {
	db, pool, cleanup := isolatedMigrationDB(t)
	defer cleanup()
	gooseDownTo(t, db, 67) // later migrations sit on top
	if version, err := goose.GetDBVersion(db); err != nil || version != 67 {
		t.Fatalf("version=%d: %v", version, err)
	}
	got := mediaConstraints(t, pool)
	for _, name := range []string{"company_site_media_kind_check", "company_site_media_content_type_check", "company_site_media_byte_size_check", "company_site_media_width_check", "company_site_media_height_check", "company_site_media_logo_format_check", "company_site_media_dimensions_check", "company_site_media_video_format_check", "company_site_media_duration_ms_check"} {
		if !got[name] {
			t.Fatalf("missing %s in %v", name, got)
		}
	}
}

// A row written before 00067 survives Up; hero videos and images follow their
// own rules.
func TestMigration00067HeroVideoConstraints(t *testing.T) {
	db, pool, cleanup := isolatedMigrationDB(t)
	defer cleanup()
	gooseDownTo(t, db, 66)
	s := newLogoSeed(t, pool)
	if _, err := s.media("hero_video", "video/mp4", 200, 200); err == nil {
		t.Fatal("hero_video accepted before 00067")
	}
	before, err := s.media("logo", "image/png", 64, 64)
	if err != nil {
		t.Fatal(err)
	}
	gooseUpTo(t, db, 67)
	var duration *int
	if err := pool.QueryRow(context.Background(), `SELECT duration_ms FROM company_site_media WHERE id=$1`, before).Scan(&duration); err != nil || duration != nil {
		t.Fatalf("existing row: %v %v", duration, err)
	}
	const mib = 1024 * 1024
	for _, tc := range []struct {
		name       string
		row        videoRow
		constraint string
	}{
		{"video with size", videoRow{"hero_video", "video/mp4", 1920, 1080, 30000, 20 * mib}, ""},
		{"video unknown size", videoRow{"hero_video", "video/mp4", nil, nil, 1, 1}, ""},
		{"video 1 px", videoRow{"hero_video", "video/mp4", 1, 1, 5000, 10}, ""},
		{"video over 20 MiB", videoRow{"hero_video", "video/mp4", 1280, 720, 5000, 20*mib + 1}, "company_site_media_byte_size_check"},
		{"video over 30 s", videoRow{"hero_video", "video/mp4", 1280, 720, 30001, 10}, "company_site_media_duration_ms_check"},
		{"video zero duration", videoRow{"hero_video", "video/mp4", 1280, 720, 0, 10}, "company_site_media_duration_ms_check"},
		{"video without duration", videoRow{"hero_video", "video/mp4", 1280, 720, nil, 10}, "company_site_media_duration_ms_check"},
		{"video half size", videoRow{"hero_video", "video/mp4", 1280, nil, 5000, 10}, "company_site_media_dimensions_check"},
		{"video zero width", videoRow{"hero_video", "video/mp4", 0, 720, 5000, 10}, "company_site_media_width_check"},
		{"video huge height", videoRow{"hero_video", "video/mp4", 1280, 16385, 5000, 10}, "company_site_media_height_check"},
		{"video as png", videoRow{"hero_video", "image/png", 1280, 720, 5000, 10}, "company_site_media_video_format_check"},
		{"cover as mp4", videoRow{"cover", "video/mp4", 1280, 720, nil, 10}, "company_site_media_video_format_check"},
		{"cover with duration", videoRow{"cover", "image/png", 200, 200, 5000, 10}, "company_site_media_duration_ms_check"},
		{"cover without size", videoRow{"cover", "image/png", nil, nil, nil, 10}, "company_site_media_width_check|company_site_media_height_check"},
		{"logo without height", videoRow{"logo", "image/png", 64, nil, nil, 10}, "company_site_media_height_check|company_site_media_dimensions_check"},
		{"cover over 5 MiB", videoRow{"cover", "image/jpeg", 200, 200, nil, 5*mib + 1}, "company_site_media_byte_size_check"},
		{"cover 199", videoRow{"cover", "image/jpeg", 199, 200, nil, 10}, "company_site_media_width_check"},
		{"logo 64", videoRow{"logo", "image/webp", 64, 64, nil, 10}, ""},
		{"logo jpeg", videoRow{"logo", "image/jpeg", 64, 64, nil, 10}, "company_site_media_logo_format_check"},
		{"unknown kind", videoRow{"video", "image/png", 200, 200, nil, 1}, "company_site_media_kind_check"},
		{"unknown type", videoRow{"hero_video", "video/webm", 1, 1, 1, 1}, "company_site_media_content_type_check|company_site_media_video_format_check"},
	} {
		_, err := s.row(tc.row)
		if tc.constraint == "" && err != nil {
			t.Fatalf("%s: %v", tc.name, err)
		}
		// Several CHECKs may reject one row; PostgreSQL names the first it evaluates.
		if tc.constraint != "" && (err == nil || !slices.ContainsFunc(strings.Split(tc.constraint, "|"), func(c string) bool { return strings.Contains(err.Error(), c) })) {
			t.Fatalf("%s: %v", tc.name, err)
		}
	}
}

// A refused Down leaves the column, the CHECKs, the videos and goose's version untouched.
func TestMigration00067DownRefusesHeroVideos(t *testing.T) {
	db, pool, cleanup := isolatedMigrationDB(t)
	defer cleanup()
	gooseDownTo(t, db, 67)
	s := newLogoSeed(t, pool)
	if _, err := s.row(videoRow{"hero_video", "video/mp4", nil, nil, 1000, 10}); err != nil {
		t.Fatal(err)
	}
	err := gooseDownOnce(t, db)
	if err == nil || !strings.Contains(err.Error(), "cannot remove hero_video site media kind: hero_video media exist") {
		t.Fatalf("Down refusal: %v", err)
	}
	if version, err := goose.GetDBVersion(db); err != nil || version != 67 {
		t.Fatalf("version=%d: %v", version, err)
	}
	if s.count("hero_video") != 1 || !mediaConstraints(t, pool)["company_site_media_duration_ms_check"] {
		t.Fatal("refused Down changed data or constraints")
	}
	if _, err := s.row(videoRow{"hero_video", "video/mp4", 640, 360, 2000, 10}); err != nil {
		t.Fatalf("hero_video rejected after refused Down: %v", err)
	}
}

// Without videos Down restores the 00066 rules exactly and Up re-applies.
func TestMigration00067DownAndUpWithoutHeroVideos(t *testing.T) {
	db, pool, cleanup := isolatedMigrationDB(t)
	defer cleanup()
	gooseDownTo(t, db, 67)
	s := newLogoSeed(t, pool)
	kept, err := s.media("logo", "image/png", 64, 64)
	if err != nil {
		t.Fatal(err)
	}
	if err := gooseDownOnce(t, db); err != nil {
		t.Fatal(err)
	}
	if version, err := goose.GetDBVersion(db); err != nil || version != 66 {
		t.Fatalf("version after Down=%d: %v", version, err)
	}
	got := mediaConstraints(t, pool)
	for _, name := range []string{"company_site_media_dimensions_check", "company_site_media_video_format_check", "company_site_media_duration_ms_check"} {
		if got[name] {
			t.Fatal(name, got)
		}
	}
	for _, name := range []string{"company_site_media_kind_check", "company_site_media_content_type_check", "company_site_media_byte_size_check", "company_site_media_width_check", "company_site_media_height_check", "company_site_media_logo_format_check"} {
		if !got[name] {
			t.Fatal(name, got)
		}
	}
	var column int
	if err := pool.QueryRow(context.Background(), `SELECT count(*) FROM information_schema.columns WHERE table_name='company_site_media' AND (column_name='duration_ms' OR (column_name IN ('width','height') AND is_nullable='YES'))`).Scan(&column); err != nil || column != 0 {
		t.Fatalf("columns after Down: %d %v", column, err)
	}
	if _, err := s.media("hero_video", "image/png", 200, 200); err == nil || !strings.Contains(err.Error(), "company_site_media_kind_check") {
		t.Fatalf("hero_video after Down: %v", err)
	}
	if _, err := s.media("cover", "video/mp4", 200, 200); err == nil || !strings.Contains(err.Error(), "company_site_media_content_type_check") {
		t.Fatalf("video/mp4 after Down: %v", err)
	}
	if _, err := s.media("logo", "image/png", 63, 64); err == nil || !strings.Contains(err.Error(), "company_site_media_width_check") {
		t.Fatalf("63 px logo after Down: %v", err)
	}
	gooseUpTo(t, db, 67)
	var n int
	if err := pool.QueryRow(context.Background(), `SELECT count(*) FROM company_site_media WHERE id=$1`, kept).Scan(&n); err != nil || n != 1 {
		t.Fatalf("row lost: %d %v", n, err)
	}
	if _, err := s.row(videoRow{"hero_video", "video/mp4", nil, nil, 30000, 10}); err != nil {
		t.Fatalf("hero_video after round trip: %v", err)
	}
}
