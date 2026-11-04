package postgres

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/netip"
	"reflect"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/audit_events/domain/entities"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/runtime/requestmeta"
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

// TestBuildInsertAuditEventParamsCompanyAndVacancy: CompanyID/VacancyID map to
// valid pgtype.UUIDs, nil to SQL NULL (audit-log-v1 §1).
func TestBuildInsertAuditEventParamsCompanyAndVacancy(t *testing.T) {
	company := uuid.MustParse("44444444-4444-4444-4444-444444444444")
	vacancy := uuid.MustParse("55555555-5555-5555-5555-555555555555")
	with := buildInsertAuditEventParams(entities.AuditEvent{ActorType: entities.ActorTypeSystem, CompanyID: &company, VacancyID: &vacancy}, []byte(`{}`))
	if with.CompanyID != (pgtype.UUID{Bytes: company, Valid: true}) || with.VacancyID != (pgtype.UUID{Bytes: vacancy, Valid: true}) {
		t.Fatalf("got %+v %+v", with.CompanyID, with.VacancyID)
	}
	without := buildInsertAuditEventParams(entities.AuditEvent{ActorType: entities.ActorTypeSystem}, []byte(`{}`))
	if without.CompanyID.Valid || without.VacancyID.Valid {
		t.Fatalf("nil ids must be NULL: %+v %+v", without.CompanyID, without.VacancyID)
	}
}

// TestApplyRequestMeta: ip, user_agent and ip_source come from the request
// context; a bare context (system jobs) leaves all three NULL, and a partial
// context keeps unknown parts NULL.
func TestApplyRequestMeta(t *testing.T) {
	ip := netip.MustParseAddr("201.141.12.7")
	ua := "Mozilla/5.0"
	base := buildInsertAuditEventParams(entities.AuditEvent{ActorType: entities.ActorTypeSystem}, []byte(`{}`))

	bare := applyRequestMeta(context.Background(), base)
	if bare.Ip != nil || bare.UserAgent.Valid || bare.IpSource.Valid {
		t.Fatalf("bare context must be all NULL: %+v", bare)
	}

	full := applyRequestMeta(requestmeta.NewContext(context.Background(), requestmeta.Meta{IP: &ip, UserAgent: &ua, IPSource: requestmeta.SourceBFF}), base)
	if full.Ip == nil || *full.Ip != ip || full.UserAgent != (pgtype.Text{String: ua, Valid: true}) || full.IpSource != (pgtype.Text{String: "bff", Valid: true}) {
		t.Fatalf("got %+v", full)
	}

	partial := applyRequestMeta(requestmeta.NewContext(context.Background(), requestmeta.Meta{IPSource: requestmeta.SourcePeer}), base)
	if partial.Ip != nil || partial.UserAgent.Valid || partial.IpSource != (pgtype.Text{String: "peer", Valid: true}) {
		t.Fatalf("got %+v", partial)
	}
}

// TestAppendRefusesBeforeTouchingTheTransaction pins the catalog gate
// (audit-log-v1 §1): an unknown type, a company-scoped type without a company
// and a metadata key outside the type's closed set are refused before any SQL
// runs, so the caller's transaction fails closed. The nil tx proves no query
// was attempted.
func TestAppendRefusesBeforeTouchingTheTransaction(t *testing.T) {
	company := uuid.New()
	cases := []struct {
		name  string
		event entities.AuditEvent
		want  error
	}{
		{"unknown type", entities.AuditEvent{EventType: "NoSuchEvent", CompanyID: &company}, entities.ErrUnknownEventType},
		{"missing company", entities.AuditEvent{EventType: entities.EventCompanyUpdated}, entities.ErrCompanyRequired},
		{"metadata key outside the set", entities.AuditEvent{EventType: entities.EventCompanyUpdated, CompanyID: &company, Metadata: map[string]string{"name": "ACME"}}, entities.ErrMetadataKeyNotAllowed},
	}
	repo := NewAuditEventRepository()
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := repo.Append(context.Background(), nil, tc.event)
			if !errors.Is(err, tc.want) {
				t.Fatalf("want %v, got %v", tc.want, err)
			}
		})
	}
}
