//go:build integration

// Migration 00064 (`placement_vacancy_documents`): placement_documents,
// placement_document_versions and placement_document_links carry the
// constraints of docs/contracts/placement-vacancy-documents-v1.md «Data model»;
// deleting a source document keeps its links with NULL source columns; Down
// refuses while any row exists in the three tables and otherwise drops them.
package migrations_test

import (
	"context"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/pressly/goose/v3"
)

type documentSeed struct{ replacementSeed }

func newDocumentSeed(t *testing.T, pool *pgxpool.Pool) documentSeed {
	t.Helper()
	return documentSeed{newReplacementSeed(t, pool)}
}

func (s documentSeed) draft() uuid.UUID {
	s.t.Helper()
	id := uuid.New()
	s.must(`INSERT INTO job_drafts(id,company_id,created_by,fields) VALUES($1,$2,$3,'{}')`, id, s.company, s.actor)
	return id
}

func (s documentSeed) document(draft uuid.UUID, participation any, name string) (uuid.UUID, error) {
	s.t.Helper()
	id := uuid.New()
	return id, s.exec(`INSERT INTO placement_documents(id,company_id,draft_id,participation_id,name,created_at,created_by) VALUES($1,$2,$3,$4,$5,now(),$6)`, id, s.company, draft, participation, name, s.actor)
}

func (s documentSeed) mustDocument(draft uuid.UUID, participation any) uuid.UUID {
	s.t.Helper()
	id, err := s.document(draft, participation, "Contrato")
	if err != nil {
		s.t.Fatal(err)
	}
	return id
}

const pdfType = "application/pdf"

func (s documentSeed) version(document uuid.UUID, version int, key, contentType string, size int64) (uuid.UUID, error) {
	s.t.Helper()
	id := uuid.New()
	return id, s.exec(`INSERT INTO placement_document_versions(id,document_id,version,storage_key,content_type,size,uploaded_at,uploaded_by) VALUES($1,$2,$3,$4,$5,$6,now(),$7)`, id, document, version, key, contentType, size, s.actor)
}

func (s documentSeed) mustVersion(document uuid.UUID, version int) uuid.UUID {
	s.t.Helper()
	id, err := s.version(document, version, randomKey(), pdfType, 10)
	if err != nil {
		s.t.Fatal(err)
	}
	return id
}

func randomKey() string {
	return strings.Repeat(strings.ReplaceAll(uuid.NewString(), "-", ""), 2)
}

func (s documentSeed) link(draft uuid.UUID, participation, source, sourceVersion any) error {
	s.t.Helper()
	return s.exec(`INSERT INTO placement_document_links(id,company_id,draft_id,participation_id,source_document_id,source_version_id,linked_at,linked_by) VALUES($1,$2,$3,$4,$5,$6,now(),$7)`, uuid.New(), s.company, draft, participation, source, sourceVersion, s.actor)
}

func TestMigration00064UpReachesVersion64(t *testing.T) {
	db, _, cleanup := isolatedMigrationDB(t)
	defer cleanup()
	gooseDownTo(t, db, 64) // 00065 sits on top
	if version, err := goose.GetDBVersion(db); err != nil || version != 64 {
		t.Fatalf("version=%d: %v", version, err)
	}
}

func TestMigration00064DocumentConstraints(t *testing.T) {
	db, pool, cleanup := isolatedMigrationDB(t)
	defer cleanup()
	gooseUpAll(t, db)
	s := newDocumentSeed(t, pool)
	draft := s.draft()
	participation := s.participation(s.process(), nil)

	for name, err := range map[string]error{
		"empty name":  second(s.document(draft, nil, "")),
		"name of 121": second(s.document(draft, nil, strings.Repeat("a", 121))),
		"unknown draft": func() error {
			return s.exec(`INSERT INTO placement_documents(id,company_id,draft_id,name,created_at,created_by) VALUES($1,$2,$3,'x',now(),$4)`, uuid.New(), s.company, uuid.New(), s.actor)
		}(),
		"unknown company": func() error {
			return s.exec(`INSERT INTO placement_documents(id,company_id,draft_id,name,created_at,created_by) VALUES($1,$2,$3,'x',now(),$4)`, uuid.New(), uuid.New(), draft, s.actor)
		}(),
		"unknown participation": second(s.document(draft, uuid.New(), "x")),
		"unknown creator": func() error {
			return s.exec(`INSERT INTO placement_documents(id,company_id,draft_id,name,created_at,created_by) VALUES($1,$2,$3,'x',now(),$4)`, uuid.New(), s.company, draft, uuid.New())
		}(),
	} {
		if err == nil {
			t.Fatalf("%s: accepted", name)
		}
	}
	for _, name := range []string{"a", strings.Repeat("ñ", 120)} {
		if _, err := s.document(draft, nil, name); err != nil {
			t.Fatalf("name %d chars: %v", len([]rune(name)), err)
		}
	}
	if _, err := s.document(draft, participation, "Oferta firmada"); err != nil {
		t.Fatal(err)
	}
	var vacancy, scoped int
	if err := pool.QueryRow(context.Background(), `SELECT count(*) FILTER (WHERE participation_id IS NULL), count(*) FILTER (WHERE participation_id IS NOT NULL) FROM placement_documents`).Scan(&vacancy, &scoped); err != nil || vacancy != 2 || scoped != 1 {
		t.Fatalf("vacancy=%d participation=%d %v", vacancy, scoped, err)
	}
	var indexes int
	if err := pool.QueryRow(context.Background(), `SELECT count(*) FROM pg_indexes WHERE indexname IN ('placement_documents_vacancy_idx','placement_documents_participation_idx','placement_document_links_vacancy_uq','placement_document_links_participation_uq','placement_document_links_source_idx')`).Scan(&indexes); err != nil || indexes != 5 {
		t.Fatalf("indexes=%d %v", indexes, err)
	}
}

func second[T any](_ T, err error) error { return err }

func TestMigration00064VersionConstraints(t *testing.T) {
	db, pool, cleanup := isolatedMigrationDB(t)
	defer cleanup()
	gooseUpAll(t, db)
	s := newDocumentSeed(t, pool)
	doc := s.mustDocument(s.draft(), nil)
	key := randomKey()
	for name, err := range map[string]error{
		"version 0":         second(s.version(doc, 0, randomKey(), pdfType, 10)),
		"version 26":        second(s.version(doc, 26, randomKey(), pdfType, 10)),
		"short key":         second(s.version(doc, 1, key[:63], pdfType, 10)),
		"long key":          second(s.version(doc, 1, key+"0", pdfType, 10)),
		"uppercase key":     second(s.version(doc, 1, strings.ToUpper(strings.Repeat("ab", 32)), pdfType, 10)),
		"non hex key":       second(s.version(doc, 1, strings.Repeat("g", 64), pdfType, 10)),
		"path as key":       second(s.version(doc, 1, "../"+key[:61], pdfType, 10)),
		"legacy word":       second(s.version(doc, 1, randomKey(), "application/msword", 10)),
		"legacy excel":      second(s.version(doc, 1, randomKey(), "application/vnd.ms-excel", 10)),
		"gif":               second(s.version(doc, 1, randomKey(), "image/gif", 10)),
		"size 0":            second(s.version(doc, 1, randomKey(), pdfType, 0)),
		"size above 10 MiB": second(s.version(doc, 1, randomKey(), pdfType, 10485761)),
		"unknown document":  second(s.version(uuid.New(), 1, randomKey(), pdfType, 10)),
		"negative size":     second(s.version(doc, 1, randomKey(), pdfType, -1)),
		"unknown uploader":  s.exec(`INSERT INTO placement_document_versions(id,document_id,version,storage_key,content_type,size,uploaded_at,uploaded_by) VALUES($1,$2,1,$3,'application/pdf',1,now(),$4)`, uuid.New(), doc, randomKey(), uuid.New()),
		"null content type": s.exec(`INSERT INTO placement_document_versions(id,document_id,version,storage_key,content_type,size,uploaded_at,uploaded_by) VALUES($1,$2,1,$3,NULL,1,now(),$4)`, uuid.New(), doc, randomKey(), s.actor),
	} {
		if err == nil {
			t.Fatalf("%s: accepted", name)
		}
	}
	for i, contentType := range []string{
		pdfType,
		"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
		"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
		"image/jpeg", "image/png",
	} {
		if _, err := s.version(doc, i+1, randomKey(), contentType, 1); err != nil {
			t.Fatalf("%s: %v", contentType, err)
		}
	}
	if _, err := s.version(doc, 25, randomKey(), pdfType, 10485760); err != nil {
		t.Fatalf("version 25 at 10 MiB: %v", err)
	}
	if _, err := s.version(doc, 1, randomKey(), pdfType, 10); err == nil {
		t.Fatal("(document, version) accepted twice")
	}
	dup := randomKey()
	if _, err := s.version(doc, 6, dup, pdfType, 10); err != nil {
		t.Fatal(err)
	}
	if _, err := s.version(s.mustDocument(s.draft(), nil), 1, dup, pdfType, 10); err == nil {
		t.Fatal("storage_key accepted twice")
	}
	if err := s.exec(`DELETE FROM placement_documents WHERE id=$1`, doc); err != nil {
		t.Fatal(err)
	}
	var left int
	if err := pool.QueryRow(context.Background(), `SELECT count(*) FROM placement_document_versions WHERE document_id=$1`, doc).Scan(&left); err != nil || left != 0 {
		t.Fatalf("versions left after deleting the document: %d %v", left, err)
	}
}

func TestMigration00064LinkConstraintsAndSetNullCascade(t *testing.T) {
	db, pool, cleanup := isolatedMigrationDB(t)
	defer cleanup()
	gooseUpAll(t, db)
	s := newDocumentSeed(t, pool)
	source, target := s.draft(), s.draft()
	sourceDoc := s.mustDocument(source, nil)
	sourceVersion := s.mustVersion(sourceDoc, 1)
	otherDoc := s.mustDocument(source, nil)
	otherVersion := s.mustVersion(otherDoc, 1)

	for name, err := range map[string]error{
		"unknown target draft":   s.link(uuid.New(), nil, sourceDoc, sourceVersion),
		"unknown participation":  s.link(target, uuid.New(), sourceDoc, sourceVersion),
		"unknown source":         s.link(target, nil, uuid.New(), sourceVersion),
		"unknown source version": s.link(target, nil, sourceDoc, uuid.New()),
	} {
		if err == nil {
			t.Fatalf("%s: accepted", name)
		}
	}
	if err := s.link(target, nil, sourceDoc, sourceVersion); err != nil {
		t.Fatal(err)
	}
	if err := s.link(target, nil, sourceDoc, sourceVersion); err == nil {
		t.Fatal("vacancy-level link accepted twice")
	}
	if err := s.link(s.draft(), nil, sourceDoc, sourceVersion); err != nil {
		t.Fatalf("same source linked from another process: %v", err)
	}
	if err := s.link(target, nil, otherDoc, otherVersion); err != nil {
		t.Fatalf("another source on the same process: %v", err)
	}
	participation := s.participation(s.process(), nil)
	if err := s.link(target, participation, sourceDoc, sourceVersion); err != nil {
		t.Fatalf("participation-level link next to the vacancy-level one: %v", err)
	}
	if err := s.link(target, participation, sourceDoc, sourceVersion); err == nil {
		t.Fatal("participation-level link accepted twice")
	}

	var sourceID, versionID *string
	var total, nullSources int
	if err := pool.QueryRow(context.Background(), `SELECT count(*) FROM placement_document_links WHERE source_document_id=$1`, sourceDoc).Scan(&total); err != nil || total != 3 {
		t.Fatalf("seeded links=%d %v", total, err)
	}
	// Deleting the source (its versions cascade away) keeps every link, with both
	// source columns NULL: the «removed» state of D19.
	if err := s.exec(`DELETE FROM placement_documents WHERE id=$1`, sourceDoc); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(context.Background(), `SELECT count(*) FROM placement_document_links`).Scan(&total); err != nil || total != 4 {
		t.Fatalf("links after deleting the source=%d %v", total, err)
	}
	if err := pool.QueryRow(context.Background(), `SELECT count(*) FROM placement_document_links WHERE source_document_id IS NULL AND source_version_id IS NULL`).Scan(&nullSources); err != nil || nullSources != 3 {
		t.Fatalf("links with NULL sources=%d %v", nullSources, err)
	}
	if err := pool.QueryRow(context.Background(), `SELECT source_document_id::text, source_version_id::text FROM placement_document_links WHERE source_document_id=$1`, otherDoc).Scan(&sourceID, &versionID); err != nil || sourceID == nil || *sourceID != otherDoc.String() || versionID == nil || *versionID != otherVersion.String() {
		t.Fatalf("an unrelated link lost its source: %v %v %v", sourceID, versionID, err)
	}
	// The unique indexes ignore removed links, so a removed link never blocks a new one.
	removedTarget := s.draft()
	if err := s.link(removedTarget, nil, nil, nil); err != nil {
		t.Fatal(err)
	}
	if err := s.link(removedTarget, nil, nil, nil); err != nil {
		t.Fatalf("two removed links on one scope: %v", err)
	}
	// Deleting only a version of a live document NULLs the version but not the document.
	liveDoc := s.mustDocument(source, nil)
	liveVersion := s.mustVersion(liveDoc, 1)
	if err := s.link(removedTarget, nil, liveDoc, liveVersion); err != nil {
		t.Fatal(err)
	}
	if err := s.exec(`DELETE FROM placement_document_versions WHERE id=$1`, liveVersion); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(context.Background(), `SELECT source_document_id::text, source_version_id::text FROM placement_document_links WHERE source_document_id=$1`, liveDoc).Scan(&sourceID, &versionID); err != nil || sourceID == nil || versionID != nil {
		t.Fatalf("version deletion: source=%v version=%v %v", sourceID, versionID, err)
	}
}

// Each table of the guard is exercised alone, and a refused Down leaves schema,
// data and goose's version row untouched.
func TestMigration00064DownRefusesDocumentData(t *testing.T) {
	for _, tc := range []struct {
		name string
		seed func(documentSeed)
	}{
		{"document", func(s documentSeed) { s.mustDocument(s.draft(), nil) }},
		{"document with version", func(s documentSeed) { s.mustVersion(s.mustDocument(s.draft(), nil), 1) }},
		{"removed link", func(s documentSeed) {
			if err := s.link(s.draft(), nil, nil, nil); err != nil {
				s.t.Fatal(err)
			}
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			db, pool, cleanup := isolatedMigrationDB(t)
			defer cleanup()
			gooseDownTo(t, db, 64) // 00065 sits on top; Down below targets 00064 itself
			tc.seed(newDocumentSeed(t, pool))
			err := gooseDownOnce(t, db)
			if err == nil || !strings.Contains(err.Error(), "cannot remove placement documents: documents, versions or links exist") {
				t.Fatalf("Down refusal: %v", err)
			}
			if version, err := goose.GetDBVersion(db); err != nil || version != 64 {
				t.Fatalf("version=%d: %v", version, err)
			}
			for _, table := range []string{"placement_documents", "placement_document_versions", "placement_document_links"} {
				if !tableExists(t, pool, table) {
					t.Fatalf("rejected Down dropped %s", table)
				}
			}
		})
	}
}

func TestMigration00064DownAndUpWithoutDocumentData(t *testing.T) {
	db, pool, cleanup := isolatedMigrationDB(t)
	defer cleanup()
	gooseDownTo(t, db, 64) // 00065 sits on top; Down below targets 00064 itself
	s := newDocumentSeed(t, pool)
	s.participation(s.process(), nil)
	if err := gooseDownOnce(t, db); err != nil {
		t.Fatal(err)
	}
	for _, table := range []string{"placement_documents", "placement_document_versions", "placement_document_links"} {
		if tableExists(t, pool, table) {
			t.Fatalf("Down left %s behind", table)
		}
	}
	if version, err := goose.GetDBVersion(db); err != nil || version != 63 {
		t.Fatalf("version after Down=%d: %v", version, err)
	}
	var participations int
	if err := pool.QueryRow(context.Background(), `SELECT count(*) FROM process_participations`).Scan(&participations); err != nil || participations != 1 {
		t.Fatalf("participations=%d %v", participations, err)
	}
	gooseUpTo(t, db, 64)
	if !tableExists(t, pool, "placement_documents") || !tableExists(t, pool, "placement_document_versions") || !tableExists(t, pool, "placement_document_links") {
		t.Fatal("Up did not restore the schema")
	}
	if version, err := goose.GetDBVersion(db); err != nil || version != 64 {
		t.Fatalf("version after round trip=%d: %v", version, err)
	}
}
