package migrations_test

import (
	migrations "github.com/aldrichcode45/peopleflow-vacantes/db/migrations"
	"io/fs"
	"strings"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/draftinput"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/draftjson"
)

const nulMigrationFixture = `{"fields":{"title":"NUL\u0000 retained","description":{"schema_version":1,"document":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"nested\u0000 ,\"location\":\"shadow\",\"remote_scope\":null}\\\\\" Ω <>&"}]}]}},"skills":["literal \\u0000","comma , brace } bracket ] quote \" slash \\"],"remote_scope":{"kind":"countries","countries":["CO","MX"]}}}`

func TestMigration00031DoesNotAssumeEnvelopeOrder(t *testing.T) {
	raw, err := fs.ReadFile(migrations.MigrationsFS, "00031_vacancy_geography.sql")
	if err != nil {
		t.Fatal(err)
	}
	for _, constraint := range []string{"cursor_pos INTEGER := 11", "expects a canonical draft envelope", "expects a supported canonical draft schema"} {
		if strings.Contains(string(raw), constraint) {
			t.Errorf("valid earlier stored fixtures are rejected by %q", constraint)
		}
	}
}

// Shared by migration SQL tests: these are the exact minimal document shapes
// inserted at versions 12/13 (draft_idempotency_migration_test.go), and 22/27
// (cv_participation/delivery_fulfillment_integration_test.go), not full codecs.
var earlierDraftFixtures = []struct{ name, body string }{
	{"00012_00013_schema_first_partial", `{"schema_version":1,"fields":{"title":"Legacy"}}`},
	{"00022_00027_empty_object", `{}`},
	{"schema_2_partial", `{"schema_version":2,"fields":{}}`},
	{"whitespace_and_reordered_nested_keys", " { \"schema_version\" : 1, \"fields\" : { \"title\" : \"NUL\\u0000 <>&\", \"location\" : \"old\\u0000\" } }\n"},
	{"noncanonical_string_escapes", `{"schema_version":2,"fields":{"title":"\u0041\u0026\u2028\u0000","location":"old"}}`},
	{"mask_collision_escaped_text", `{"schema_version":1,"fields":{"title":"\u007egeo_nul_0!","location":"old\u0000"}}`},
	{"multiple_mask_collisions_retained_nul", `{"schema_version":2,"fields":{"title":"~geo_nul_0! ~geo_nul_1! \u0000","location":null}}`},
	{"mask_collision_without_nul", `{"schema_version":1,"fields":{"title":"~geo_nul_0! literal \\u0000"}}`},
}

func expectedGeographyDocument(t *testing.T, source []byte, up bool) []byte {
	t.Helper()
	value, err := draftjson.Decode(source)
	if err != nil {
		t.Fatal(err)
	}
	if root, ok := value.(map[string]any); ok {
		if fields, ok := root["fields"].(map[string]any); ok {
			if _, present := fields["location"]; present {
				if _, oldString := fields["location"].(string); !up || oldString {
					fields["location"] = nil
				}
			}
			delete(fields, "remote_scope")
			if up {
				fields["remote_scope"] = nil
			}
		}
	}
	result, err := draftjson.EncodeValidatedValue(value)
	if err != nil {
		t.Fatal(err)
	}
	return result
}

func TestMigration00031HistoricalFixtureOracle(t *testing.T) {
	for _, tc := range earlierDraftFixtures {
		t.Run(tc.name, func(t *testing.T) {
			after := expectedGeographyDocument(t, []byte(tc.body), true)
			restored := expectedGeographyDocument(t, after, false)
			if _, err := draftjson.Decode(restored); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestMigration00031NULFixtureIsValidCanonicalDraft(t *testing.T) {
	draft, err := draftinput.DecodeCreateV2([]byte(nulMigrationFixture))
	if err != nil {
		t.Fatal(err)
	}
	if err := draftinput.ValidatePersistedDraftV2(draft.Fingerprint()); err != nil {
		t.Fatal(err)
	}
	value, err := draftjson.Decode(draft.Fingerprint())
	if err != nil {
		t.Fatal(err)
	}
	if title := value.(map[string]any)["fields"].(map[string]any)["title"]; title != "NUL\x00 retained" {
		t.Fatal("NUL not retained", title)
	}
	plain, ok := draft.DescriptionPlain()
	if !ok || !strings.ContainsRune(plain, 0) || !strings.Contains(plain, `"location":"shadow"`) {
		t.Fatal("NUL/decoy not retained", plain)
	}
}

// Only NUL-masked bytes may cross PostgreSQL's Unicode-decoding JSON boundary.
func TestMigration00031MasksNULBeforeJSONDecoding(t *testing.T) {
	raw, err := fs.ReadFile(migrations.MigrationsFS, "00031_vacancy_geography.sql")
	if err != nil {
		t.Fatal(err)
	}
	sql := string(raw)
	if strings.Count(sql, "parsed := convert_from(masked,'UTF8')::jsonb;") != 2 {
		t.Fatal("both directions must parse only masked JSON")
	}
	for _, unsafe := range []string{"convert_from(document,", "convert_from(source,", "document::json", "source::json"} {
		if strings.Contains(sql, unsafe) {
			t.Errorf("unmasked JSON decoding: %s", unsafe)
		}
	}
	for _, guard := range []string{"seen_count=nul_count", "cursor_pos := cursor_pos+2", "chr(92)||'u0000'", "replace(pg_temp.geo_canonical(parsed),marker"} {
		if strings.Count(sql, guard) < 2 {
			t.Errorf("missing mask/collision/restore guard in both directions: %s", guard)
		}
	}
	// Goose SQL up/down can run in different processes. Both directions must
	// independently install identical temporary masking/canonical helpers.
	canonicalParts := strings.Split(string(raw), "CREATE OR REPLACE FUNCTION pg_temp.geo_canonical")
	if len(canonicalParts) != 3 {
		t.Fatal("both directions must define canonical encoder")
	}
	first, _, _ := strings.Cut(canonicalParts[1], "END $$;")
	second, _, _ := strings.Cut(canonicalParts[2], "END $$;")
	if first != second {
		t.Fatal("up/down canonical encoders differ")
	}

	parts := strings.Split(string(raw), "CREATE OR REPLACE FUNCTION pg_temp.geo_rewrite")
	if len(parts) != 3 {
		t.Fatal("both directions must define the scanner independently")
	}
	up, _, upOK := strings.Cut(parts[1], "END $$;")
	down, _, downOK := strings.Cut(parts[2], "END $$;")
	if !upOK || !downOK || up != down {
		t.Fatal("up/down scanner implementations differ")
	}
}

func TestMigration00031VacancyGeographyDefinition(t *testing.T) {
	raw, err := fs.ReadFile(migrations.MigrationsFS, "00031_vacancy_geography.sql")
	if err != nil {
		t.Fatal(err)
	}
	sql := string(raw)
	for _, fragment := range []string{"ADD COLUMN country_code CHAR(2) REFERENCES geo_countries(code)", "REFERENCES geo_states(country_code,code)", "REFERENCES geo_municipalities(country_code,code)", "ADD COLUMN postal_code CHAR(5)", "ADD COLUMN remote_countries CHAR(2)[]", "work_mode='remote'", "DROP COLUMN location", "vacancy_public_state_idx", "vacancy_public_municipality_idx", "USING GIN(remote_countries)", "pg_temp.geo_rewrite(document BYTEA, upgrade BOOLEAN)", "get_byte(source,cursor_pos)", "IF jsonb_typeof(parsed->'fields')='object'", "ORDER BY key COLLATE \"C\"", "ORDER BY ord", "pg_temp.geo_rewrite(fields,TRUE)", "pg_temp.geo_rewrite(fields,FALSE)", "version=version+1", "ADD COLUMN location TEXT NOT NULL DEFAULT ''"} {
		if !strings.Contains(sql, fragment) {
			t.Errorf("missing %q", fragment)
		}
	}
}
