package postgres

import (
	"bytes"
	"encoding/json"
	"reflect"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/audit_events/domain/entities"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

// TestBuildInsertAuditEventParams pins the domain→sqlc mapping (design D4 +
// design §7 item 11): a non-nil *uuid.UUID actor maps to
// pgtype.UUID{Valid: true} carrying the same bytes ('user' events), nil maps
// to the pgtype.UUID zero value ('system' events → SQL NULL), Metadata is
// passed through as the JSON-marshaled []byte for the JSONB column, and every
// scalar field is mapped 1:1.
func TestBuildInsertAuditEventParams(t *testing.T) {
	eventID := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	entityID := uuid.MustParse("22222222-2222-2222-2222-222222222222")
	actorID := uuid.MustParse("33333333-3333-3333-3333-333333333333")

	metadata := map[string]string{
		"job_id": entityID.String(),
		"source": "linkedin",
	}
	meta, err := json.Marshal(metadata)
	if err != nil {
		t.Fatalf("marshal metadata: %v", err)
	}

	event := entities.AuditEvent{
		ID:         eventID,
		ActorType:  entities.ActorTypeUser,
		ActorID:    &actorID,
		EventType:  entities.EventApplicationSubmitted,
		EntityType: entities.EntityApplication,
		EntityID:   entityID,
		Metadata:   metadata,
	}

	params := buildInsertAuditEventParams(event, meta)

	// Scalar fields pinned 1:1.
	if params.ID != eventID {
		t.Errorf("ID: want %v, got %v", eventID, params.ID)
	}
	if params.ActorType != "user" {
		t.Errorf("ActorType: want %q, got %q", "user", params.ActorType)
	}
	if params.EventType != "ApplicationSubmitted" {
		t.Errorf("EventType: want %q, got %q", "ApplicationSubmitted", params.EventType)
	}
	if params.EntityType != "application" {
		t.Errorf("EntityType: want %q, got %q", "application", params.EntityType)
	}
	if params.EntityID != entityID {
		t.Errorf("EntityID: want %v, got %v", entityID, params.EntityID)
	}

	// Non-nil *uuid.UUID → pgtype.UUID{Valid: true} with the same bytes.
	if params.ActorID != (pgtype.UUID{Bytes: actorID, Valid: true}) {
		t.Errorf("ActorID: want %+v, got %+v", pgtype.UUID{Bytes: actorID, Valid: true}, params.ActorID)
	}

	// Metadata marshaled to []byte, byte-identical to json.Marshal output and
	// round-tripping to the same map.
	if len(params.Metadata) == 0 {
		t.Error("Metadata: want non-empty marshaled JSONB bytes")
	}
	if !bytes.Equal(params.Metadata, meta) {
		t.Errorf("Metadata bytes: want %q, got %q", meta, params.Metadata)
	}
	var round map[string]string
	if err := json.Unmarshal(params.Metadata, &round); err != nil {
		t.Fatalf("unmarshal Metadata: %v", err)
	}
	if !reflect.DeepEqual(round, metadata) {
		t.Errorf("Metadata round-trip: want %v, got %v", metadata, round)
	}

	// nil *uuid.UUID → pgtype.UUID{} (zero value; SQL NULL for 'system').
	nilEvent := event
	nilEvent.ActorID = nil
	nilParams := buildInsertAuditEventParams(nilEvent, meta)
	if nilParams.ActorID != (pgtype.UUID{}) {
		t.Errorf("nil ActorID: want pgtype.UUID{}, got %+v", nilParams.ActorID)
	}
}
