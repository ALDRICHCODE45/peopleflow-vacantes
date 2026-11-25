//go:build integration

// Migration 00066 (`company_site_logo_media`): company_site_media accepts the
// kind `logo` (PNG/WebP only, 64..6000 px per side) while every other kind keeps
// its 200 px floor; existing rows are untouched; Down refuses while any logo
// exists and otherwise restores the 00047 CHECKs under the same names.
package migrations_test

import (
	"context"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/pressly/goose/v3"
)

type logoSeed struct{ replacementSeed }

func newLogoSeed(t *testing.T, pool *pgxpool.Pool) logoSeed {
	t.Helper()
	return logoSeed{newReplacementSeed(t, pool)}
}

func (s logoSeed) media(kind, contentType string, width, height int) (uuid.UUID, error) {
	s.t.Helper()
	id := uuid.New()
	return id, s.exec(`INSERT INTO company_site_media(id,company_id,kind,storage_key,content_type,width,height,byte_size,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,1,$8)`, id, s.company, kind, "key-"+id.String(), contentType, width, height, s.actor)
}

func (s logoSeed) count(kind string) int {
	s.t.Helper()
	var n int
	if err := s.pool.QueryRow(context.Background(), `SELECT count(*) FROM company_site_media WHERE company_id=$1 AND kind=$2`, s.company, kind).Scan(&n); err != nil {
		s.t.Fatal(err)
	}
	return n
}

func mediaConstraints(t *testing.T, pool *pgxpool.Pool) map[string]bool {
	t.Helper()
	rows, err := pool.Query(context.Background(), `SELECT conname FROM pg_constraint WHERE conrelid='company_site_media'::regclass AND contype='c'`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	out := map[string]bool{}
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			t.Fatal(err)
		}
		out[name] = true
	}
	return out
}

func TestMigration00066UpReachesVersion66(t *testing.T) {
	db, pool, cleanup := isolatedMigrationDB(t)
	defer cleanup()
	gooseDownTo(t, db, 66) // later migrations sit on top
	if version, err := goose.GetDBVersion(db); err != nil || version != 66 {
		t.Fatalf("version=%d: %v", version, err)
	}
	got := mediaConstraints(t, pool)
	for _, name := range []string{"company_site_media_kind_check", "company_site_media_width_check", "company_site_media_height_check", "company_site_media_logo_format_check", "company_site_media_content_type_check", "company_site_media_byte_size_check"} {
		if !got[name] {
			t.Fatalf("missing %s in %v", name, got)
		}
	}
}

// A row written before 00066 survives Up; logos follow their own floor and
// formats, other kinds keep 200 px and unknown kinds stay rejected.
func TestMigration00066LogoConstraints(t *testing.T) {
	db, pool, cleanup := isolatedMigrationDB(t)
	defer cleanup()
	gooseDownTo(t, db, 65)
	s := newLogoSeed(t, pool)
	if _, err := s.media("logo", "image/png", 200, 200); err == nil {
		t.Fatal("logo accepted before 00066")
	}
	before, err := s.media("cover", "image/jpeg", 200, 200)
	if err != nil {
		t.Fatal(err)
	}
	gooseUpTo(t, db, 66)
	var kind string
	if err := pool.QueryRow(context.Background(), `SELECT kind FROM company_site_media WHERE id=$1`, before).Scan(&kind); err != nil || kind != "cover" {
		t.Fatalf("existing row: %q %v", kind, err)
	}
	for _, tc := range []struct {
		name, kind, contentType string
		width, height           int
		constraint              string
	}{
		{"logo png 64", "logo", "image/png", 64, 64, ""},
		{"logo webp wide", "logo", "image/webp", 6000, 64, ""},
		{"logo 63 wide", "logo", "image/png", 63, 64, "company_site_media_width_check"},
		{"logo 63 high", "logo", "image/webp", 64, 63, "company_site_media_height_check"},
		{"logo 6001", "logo", "image/png", 6001, 64, "company_site_media_width_check"},
		{"logo jpeg", "logo", "image/jpeg", 200, 200, "company_site_media_logo_format_check"},
		{"cover 64", "cover", "image/png", 64, 200, "company_site_media_width_check"},
		{"portrait 199", "portrait", "image/png", 200, 199, "company_site_media_height_check"},
		{"story jpeg 200", "story", "image/jpeg", 200, 200, ""},
		{"unknown kind", "video", "image/png", 200, 200, "company_site_media_kind_check"},
		{"logo gif", "logo", "image/gif", 64, 64, "company_site_media_content_type_check"},
	} {
		_, err := s.media(tc.kind, tc.contentType, tc.width, tc.height)
		if tc.constraint == "" && err != nil {
			t.Fatalf("%s: %v", tc.name, err)
		}
		if tc.constraint != "" && (err == nil || !strings.Contains(err.Error(), tc.constraint)) {
			t.Fatalf("%s: %v", tc.name, err)
		}
	}
}

// A refused Down leaves the relaxed CHECKs, the logos and goose's version untouched.
func TestMigration00066DownRefusesLogos(t *testing.T) {
	db, pool, cleanup := isolatedMigrationDB(t)
	defer cleanup()
	gooseDownTo(t, db, 66)
	s := newLogoSeed(t, pool)
	if _, err := s.media("logo", "image/png", 64, 64); err != nil {
		t.Fatal(err)
	}
	err := gooseDownOnce(t, db)
	if err == nil || !strings.Contains(err.Error(), "cannot remove logo site media kind: logo media exist") {
		t.Fatalf("Down refusal: %v", err)
	}
	if version, err := goose.GetDBVersion(db); err != nil || version != 66 {
		t.Fatalf("version=%d: %v", version, err)
	}
	if s.count("logo") != 1 || !mediaConstraints(t, pool)["company_site_media_logo_format_check"] {
		t.Fatal("refused Down changed data or constraints")
	}
	if _, err := s.media("logo", "image/webp", 64, 64); err != nil {
		t.Fatalf("logo rejected after refused Down: %v", err)
	}
}

// Without logos Down restores the 00047 rules exactly and Up re-applies.
func TestMigration00066DownAndUpWithoutLogos(t *testing.T) {
	db, pool, cleanup := isolatedMigrationDB(t)
	defer cleanup()
	gooseDownTo(t, db, 66)
	s := newLogoSeed(t, pool)
	kept, err := s.media("gallery", "image/webp", 200, 200)
	if err != nil {
		t.Fatal(err)
	}
	if err := gooseDownOnce(t, db); err != nil {
		t.Fatal(err)
	}
	if version, err := goose.GetDBVersion(db); err != nil || version != 65 {
		t.Fatalf("version after Down=%d: %v", version, err)
	}
	got := mediaConstraints(t, pool)
	if got["company_site_media_logo_format_check"] || !got["company_site_media_kind_check"] || !got["company_site_media_width_check"] || !got["company_site_media_height_check"] {
		t.Fatal(got)
	}
	if _, err := s.media("logo", "image/png", 200, 200); err == nil || !strings.Contains(err.Error(), "company_site_media_kind_check") {
		t.Fatalf("logo after Down: %v", err)
	}
	if _, err := s.media("cover", "image/png", 199, 200); err == nil || !strings.Contains(err.Error(), "company_site_media_width_check") {
		t.Fatalf("199 px after Down: %v", err)
	}
	gooseUpTo(t, db, 66)
	var n int
	if err := pool.QueryRow(context.Background(), `SELECT count(*) FROM company_site_media WHERE id=$1`, kept).Scan(&n); err != nil || n != 1 {
		t.Fatalf("row lost: %d %v", n, err)
	}
	if _, err := s.media("logo", "image/png", 64, 64); err != nil {
		t.Fatalf("logo after round trip: %v", err)
	}
}
