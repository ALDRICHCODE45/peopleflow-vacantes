//go:build integration

package v2

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"testing"

	app "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/application/v2"
	"github.com/google/uuid"
)

func seedApplyGeo(t *testing.T, f fixture) {
	t.Helper()
	for _, q := range []string{
		`INSERT INTO geo_countries VALUES('MX','México','Mexico'),('CO','Colombia','Colombia'),('US','Estados Unidos','United States') ON CONFLICT DO NOTHING`,
		`INSERT INTO geo_states VALUES('MX','14','Jalisco','Jal.') ON CONFLICT DO NOTHING`,
		`INSERT INTO geo_municipalities VALUES('MX','14','14039','Guadalajara') ON CONFLICT DO NOTHING`,
	} {
		if _, err := f.pool.Exec(context.Background(), q); err != nil {
			t.Fatal(err)
		}
	}
}

func applyProfileCountry(t *testing.T, f fixture, country any) {
	t.Helper()
	t.Cleanup(func() {
		if _, err := f.pool.Exec(context.Background(), `DELETE FROM candidate_profiles WHERE user_id=$1`, f.actor); err != nil {
			t.Error(err)
		}
	})
	if _, err := f.pool.Exec(context.Background(), `INSERT INTO candidate_profiles(user_id,country_code) VALUES($1,$2) ON CONFLICT(user_id) DO UPDATE SET country_code=EXCLUDED.country_code,state_code=NULL,municipality_code=NULL`, f.actor, country); err != nil {
		t.Fatal(err)
	}
}

func TestGeoApplyPublishedCountryGateAndNoWrites(t *testing.T) {
	for _, tc := range []struct {
		name, mode     string
		scope, country any
		want           error
	}{
		{"missing profile", "remote", "countries", nil, app.ErrApplicantCountryRequired},
		{"missing country", "remote", "countries", "", app.ErrApplicantCountryRequired},
		{"not allowed", "remote", "countries", "US", app.ErrApplicantCountryNotAllowed},
		{"first allowed", "remote", "countries", "CO", nil},
		{"last allowed", "remote", "countries", "MX", nil},
		{"anywhere", "remote", "anywhere", nil, nil},
		{"onsite", "onsite", nil, nil, nil},
		{"hybrid", "hybrid", nil, "US", nil},
	} {
		t.Run(tc.name, func(t *testing.T) {
			f := setup(t)
			seedApplyGeo(t, f)
			ctx := context.Background()
			var allowed []string
			if tc.scope == "countries" {
				allowed = []string{"CO", "MX"}
			}
			if _, err := f.pool.Exec(ctx, `UPDATE vacancy_public_projections SET work_mode=$2,remote_scope_kind=$3,remote_countries=$4 WHERE id=$1`, f.vacancy, tc.mode, tc.scope, allowed); err != nil {
				t.Fatal(err)
			}
			// Authoring fields in setup have no scope or mode: only the published
			// projection may decide eligibility, not the mutable draft document.
			if tc.country != nil {
				c := tc.country
				if c == "" {
					c = nil
				}
				applyProfileCountry(t, f, c)
			}
			cv, err := f.library.Upload(ctx, f.sub, "CV", "cv.pdf", []byte("%PDF-1"))
			if err != nil {
				t.Fatal(err)
			}
			req := f.request(cv.ID)
			before := f.effects(t)
			if tc.want != nil {
				for _, variant := range []string{"valid", "stale", "answers", "cv"} {
					bad := req
					switch variant {
					case "stale":
						bad.Revision = "stale"
					case "answers":
						bad.Answers = nil
					case "cv":
						bad.CVID = uuid.New()
					}
					_, err = f.store.Apply(ctx, f.sub, f.vacancy, uuid.New(), bad)
					var restriction *app.CountryRestriction
					if !errors.Is(err, tc.want) || !errors.As(err, &restriction) || !reflect.DeepEqual(restriction.Allowed, []string{"CO", "MX"}) {
						t.Fatalf("%s: %#v", variant, err)
					}
					if before != f.effects(t) {
						t.Fatal("country rejection wrote participation/snapshot/history/audit/idempotency")
					}
				}
				return
			}
			if _, err = f.store.Apply(ctx, f.sub, f.vacancy, uuid.New(), req); err != nil {
				t.Fatal(err)
			}
			f.assertSingleEffects(t)
		})
	}
}

func TestGeoApplyReplayBeforeCurrentCountryGateAndDuplicate(t *testing.T) {
	f := setup(t)
	seedApplyGeo(t, f)
	ctx := context.Background()
	applyProfileCountry(t, f, "MX")
	cv, err := f.library.Upload(ctx, f.sub, "CV", "cv.pdf", []byte("%PDF-1"))
	if err != nil {
		t.Fatal(err)
	}
	req, key := f.request(cv.ID), uuid.New()
	original, err := f.store.Apply(ctx, f.sub, f.vacancy, key, req)
	if err != nil {
		t.Fatal(err)
	}
	var snapshot []byte
	if err = f.pool.QueryRow(ctx, `SELECT profile_snapshot FROM process_participations WHERE process_id=$1`, f.vacancy).Scan(&snapshot); err != nil {
		t.Fatal(err)
	}
	if _, err = f.pool.Exec(ctx, `UPDATE vacancy_public_projections SET remote_scope_kind='countries',remote_countries=ARRAY['CO','MX']::char(2)[] WHERE id=$1`, f.vacancy); err != nil {
		t.Fatal(err)
	}
	for _, country := range []any{"US", nil} {
		applyProfileCountry(t, f, country)
		before := f.effects(t)
		replay, err := f.store.Apply(ctx, f.sub, f.vacancy, key, req)
		if err != nil || !replay.Replayed || !bytes.Equal(original.Body, replay.Body) {
			t.Fatal("gate invalidated success", err)
		}
		_, err = f.store.Apply(ctx, f.sub, f.vacancy, uuid.New(), req)
		want := app.ErrApplicantCountryNotAllowed
		if country == nil {
			want = app.ErrApplicantCountryRequired
		}
		if !errors.Is(err, want) {
			t.Fatal("duplicate ran before country gate", err)
		}
		changed := req
		changed.Revision = "different"
		if _, err = f.store.Apply(ctx, f.sub, f.vacancy, key, changed); !errors.Is(err, app.ErrIdempotencyConflict) {
			t.Fatal(err)
		}
		var after []byte
		if err = f.pool.QueryRow(ctx, `SELECT profile_snapshot FROM process_participations WHERE process_id=$1`, f.vacancy).Scan(&after); err != nil || !bytes.Equal(snapshot, after) || before != f.effects(t) {
			t.Fatal("replay/rejection changed snapshot or effects", err)
		}
	}
}

func TestGeoSnapshotMissingCatalogReferenceFailsClosed(t *testing.T) {
	m := setupMovement(t)
	seedApplyGeo(t, m.fixture)
	for _, location := range []string{
		`{"country":"ZZ","state":null,"municipality":null}`,
		`{"country":"MX","state":"99","municipality":null}`,
		`{"country":"MX","state":"14","municipality":"14999"}`,
	} {
		raw := `{"location":` + location + `,"skills":[],"years_of_experience":null,"education_level":null}`
		if _, err := m.pool.Exec(context.Background(), `UPDATE process_participations SET profile_snapshot=$2 WHERE id=$1`, m.item.ID, []byte(raw)); err != nil {
			t.Fatal(err)
		}
		if _, err := m.board.Detail(context.Background(), m.company, m.recruiter, m.vacancy, m.item.ID); err == nil {
			t.Fatal("missing catalog reference returned a partial detail")
		}
		if _, err := m.board.Board(context.Background(), m.company, m.recruiter, m.vacancy); err == nil {
			t.Fatal("missing catalog reference returned a partial board")
		}
	}
}

func TestGeoSnapshotCurrentCodesAndExpandedBoardDetailWire(t *testing.T) {
	for _, tc := range []struct {
		name, country       string
		state, municipality any
		countryName, label  string
	}{
		{"country", "CO", nil, nil, "Colombia", "Colombia"},
		{"state", "MX", "14", nil, "México", "Jalisco"},
		{"municipality", "MX", "14", "14039", "México", "Guadalajara, Jalisco"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			m := setupMovement(t)
			seedApplyGeo(t, m.fixture)
			ctx := context.Background()
			var candidate uuid.UUID
			if err := m.pool.QueryRow(ctx, `SELECT id FROM users WHERE cognito_sub=$1`, m.other).Scan(&candidate); err != nil {
				t.Fatal(err)
			}
			if _, err := m.pool.Exec(ctx, `INSERT INTO candidate_profiles(user_id,country_code,state_code,municipality_code,skills,years_of_experience,education_level) VALUES($1,$2,$3,$4,ARRAY['Go','SQL','Go'],0,'master')`, candidate, tc.country, tc.state, tc.municipality); err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() {
				if _, err := m.pool.Exec(context.Background(), `DELETE FROM candidate_profiles WHERE user_id=$1`, candidate); err != nil {
					t.Error(err)
				}
			})
			cv, err := m.library.Upload(ctx, m.other, "CV", "cv.pdf", []byte("%PDF-1"))
			if err != nil {
				t.Fatal(err)
			}
			req, key := m.request(cv.ID), uuid.New()
			result, err := m.store.Apply(ctx, m.other, m.vacancy, key, req)
			if err != nil {
				t.Fatal(err)
			}
			assertNoFilterData(t, result.Body)
			var submitted app.Submitted
			if err = json.Unmarshal(result.Body, &submitted); err != nil {
				t.Fatal(err)
			}
			var snapshot []byte
			if err = m.pool.QueryRow(ctx, `SELECT profile_snapshot FROM process_participations WHERE id=$1`, submitted.ID).Scan(&snapshot); err != nil {
				t.Fatal(err)
			}
			stored := movementKeys(t, movementObject(t, snapshot), "location", "skills", "years_of_experience", "education_level")
			wantCodes := map[string]any{"country": tc.country, "state": tc.state, "municipality": tc.municipality}
			if !reflect.DeepEqual(stored["location"], wantCodes) {
				t.Fatal(stored)
			}
			// The current profile changes before either authorized read. Reads must
			// expand the frozen codes, never consult the candidate's current profile.
			if _, err = m.pool.Exec(ctx, `UPDATE candidate_profiles SET country_code='US',state_code=NULL,municipality_code=NULL,skills=ARRAY['Rust'] WHERE user_id=$1`, candidate); err != nil {
				t.Fatal(err)
			}
			wantLocation := map[string]any{"country": map[string]any{"id": tc.country, "name": tc.countryName}, "state": nil, "municipality": nil, "postal_code": nil, "label": tc.label}
			if tc.state != nil {
				wantLocation["state"] = map[string]any{"id": tc.state, "name": "Jalisco"}
			}
			if tc.municipality != nil {
				wantLocation["municipality"] = map[string]any{"id": tc.municipality, "name": "Guadalajara"}
			}
			want := map[string]any{"location": wantLocation, "skills": []any{"Go", "SQL", "Go"}, "years_of_experience": float64(0), "education_level": "master"}
			detail := movementRequest(t, m, "GET", m.vacancy, submitted.ID, "", "", "")
			if detail.Code != 200 {
				t.Fatal(detail.Code, detail.Body.String())
			}
			d := movementObject(t, detail.Body.Bytes())
			movementItemKeys(t, d, "screening", "comment", "candidate_message")
			if !reflect.DeepEqual(d["profile"], want) {
				t.Fatal(d["profile"])
			}
			board := movementRequest(t, m, "GET", m.vacancy, uuid.Nil, "", "", "")
			if board.Code != 200 {
				t.Fatal(board.Code, board.Body.String())
			}
			found := false
			for _, raw := range movementObject(t, board.Body.Bytes())["participations"].([]any) {
				item := raw.(map[string]any)
				movementItemKeys(t, item)
				if item["id"] == submitted.ID.String() {
					found = true
					if !reflect.DeepEqual(item["profile"], want) {
						t.Fatal(item["profile"])
					}
				}
			}
			if !found {
				t.Fatal("applied item missing")
			}
			replay, err := m.store.Apply(ctx, m.other, m.vacancy, key, req)
			if err != nil || !replay.Replayed || !bytes.Equal(replay.Body, result.Body) {
				t.Fatal(err)
			}
		})
	}
}
