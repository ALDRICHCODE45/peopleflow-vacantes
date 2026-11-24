//go:build integration

// Migration 00065 (`stakeholder_invitation_note`): stakeholder_invitations.note
// is an additive nullable column of 1..80 code points (audit gap D11); existing
// rows keep NULL; Down refuses while any note exists and otherwise drops only
// the column.
package migrations_test

import (
	"context"
	"crypto/rand"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/pressly/goose/v3"
)

type noteSeed struct{ replacementSeed }

func newNoteSeed(t *testing.T, pool *pgxpool.Pool) noteSeed {
	t.Helper()
	return noteSeed{newReplacementSeed(t, pool)}
}

// invitation inserts a pending invitation with the given note (nil = NULL).
func (s noteSeed) invitation(note any) (uuid.UUID, error) {
	s.t.Helper()
	id := uuid.New()
	hash := make([]byte, 32)
	if _, err := rand.Read(hash); err != nil {
		s.t.Fatal(err)
	}
	return id, s.exec(`INSERT INTO stakeholder_invitations(id,company_id,token_sha256,created_by,created_at,expires_at,note) VALUES($1,$2,$3,$4,now(),now()+interval '7 days',$5)`, id, s.company, hash, s.actor, note)
}

// legacyInvitation inserts without naming the column, as every writer before 00065 did.
func (s noteSeed) legacyInvitation() uuid.UUID {
	s.t.Helper()
	id := uuid.New()
	hash := make([]byte, 32)
	if _, err := rand.Read(hash); err != nil {
		s.t.Fatal(err)
	}
	s.must(`INSERT INTO stakeholder_invitations(id,company_id,token_sha256,created_by,created_at,expires_at) VALUES($1,$2,$3,$4,now(),now()+interval '7 days')`, id, s.company, hash, s.actor)
	return id
}

func (s noteSeed) noteOf(id uuid.UUID) *string {
	s.t.Helper()
	var note *string
	if err := s.pool.QueryRow(context.Background(), `SELECT note FROM stakeholder_invitations WHERE id=$1`, id).Scan(&note); err != nil {
		s.t.Fatal(err)
	}
	return note
}

func TestMigration00065UpReachesVersion65(t *testing.T) {
	db, _, cleanup := isolatedMigrationDB(t)
	defer cleanup()
	gooseDownTo(t, db, 65) // later migrations sit on top
	if version, err := goose.GetDBVersion(db); err != nil || version != 65 {
		t.Fatalf("version=%d: %v", version, err)
	}
}

// A row written before 00065 keeps NULL after Up; the column accepts NULL and
// 1..80 code points (multibyte counted as one) and nothing else.
func TestMigration00065NoteConstraint(t *testing.T) {
	db, pool, cleanup := isolatedMigrationDB(t)
	defer cleanup()
	gooseDownTo(t, db, 64) // the row below is written before 00065
	s := newNoteSeed(t, pool)
	before := s.legacyInvitation()
	gooseUpTo(t, db, 65)
	if !columnExists(t, pool, "stakeholder_invitations", "note") {
		t.Fatal("Up did not add stakeholder_invitations.note")
	}
	if note := s.noteOf(before); note != nil {
		t.Fatalf("existing row note = %q, want NULL", *note)
	}
	var nullable string
	if err := pool.QueryRow(context.Background(), `SELECT is_nullable FROM information_schema.columns WHERE table_name='stakeholder_invitations' AND column_name='note'`).Scan(&nullable); err != nil || nullable != "YES" {
		t.Fatalf("is_nullable=%q %v", nullable, err)
	}
	for name, note := range map[string]string{
		"empty":        "",
		"81 ascii":     strings.Repeat("a", 81),
		"81 multibyte": strings.Repeat("ñ", 81),
		"81 four-byte": strings.Repeat("😀", 81),
	} {
		if _, err := s.invitation(note); err == nil || !strings.Contains(err.Error(), "stakeholder_invitations_note_length") {
			t.Fatalf("%s: %v", name, err)
		}
	}
	for name, note := range map[string]any{
		"null":         nil,
		"one":          "a",
		"80 ascii":     strings.Repeat("a", 80),
		"80 multibyte": strings.Repeat("ñ", 80),
		"80 four-byte": strings.Repeat("😀", 80),
	} {
		id, err := s.invitation(note)
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		got := s.noteOf(id)
		if (note == nil) != (got == nil) || (got != nil && *got != note.(string)) {
			t.Fatalf("%s: stored %v", name, got)
		}
	}
}

// A refused Down leaves the column, the notes and goose's version untouched.
func TestMigration00065DownRefusesNotes(t *testing.T) {
	db, pool, cleanup := isolatedMigrationDB(t)
	defer cleanup()
	gooseDownTo(t, db, 65) // later migrations sit on top; Down below targets 00065 itself
	s := newNoteSeed(t, pool)
	s.legacyInvitation()
	id, err := s.invitation("Consejo")
	if err != nil {
		t.Fatal(err)
	}
	err = gooseDownOnce(t, db)
	if err == nil || !strings.Contains(err.Error(), "cannot remove stakeholder invitation notes: notes exist") {
		t.Fatalf("Down refusal: %v", err)
	}
	if version, err := goose.GetDBVersion(db); err != nil || version != 65 {
		t.Fatalf("version=%d: %v", version, err)
	}
	if note := s.noteOf(id); note == nil || *note != "Consejo" {
		t.Fatalf("note after refused Down = %v", note)
	}
}

// Without notes Down drops only the column: the invitations stay, and Up
// restores the column with NULL for them.
func TestMigration00065DownAndUpWithoutNotes(t *testing.T) {
	db, pool, cleanup := isolatedMigrationDB(t)
	defer cleanup()
	gooseDownTo(t, db, 65) // later migrations sit on top; Down below targets 00065 itself
	s := newNoteSeed(t, pool)
	kept := s.legacyInvitation()
	if _, err := s.invitation(nil); err != nil {
		t.Fatal(err)
	}
	if err := gooseDownOnce(t, db); err != nil {
		t.Fatal(err)
	}
	if columnExists(t, pool, "stakeholder_invitations", "note") {
		t.Fatal("Down left stakeholder_invitations.note behind")
	}
	if version, err := goose.GetDBVersion(db); err != nil || version != 64 {
		t.Fatalf("version after Down=%d: %v", version, err)
	}
	var invitations int
	if err := pool.QueryRow(context.Background(), `SELECT count(*) FROM stakeholder_invitations WHERE company_id=$1`, s.company).Scan(&invitations); err != nil || invitations != 2 {
		t.Fatalf("invitations after Down=%d %v", invitations, err)
	}
	gooseUpTo(t, db, 65)
	if note := s.noteOf(kept); note != nil {
		t.Fatalf("note after round trip = %q", *note)
	}
	if version, err := goose.GetDBVersion(db); err != nil || version != 65 {
		t.Fatalf("version after round trip=%d: %v", version, err)
	}
}
