package metricsdemo

import (
	"strings"
	"testing"
)

func TestCheckDatabaseURL(t *testing.T) {
	for _, dsn := range []string{
		"postgres://dev:dev@127.0.0.1:5432/peopleflow_vacancies?sslmode=disable",
		"postgresql://dev:dev@localhost/peopleflow_vacancies",
		"postgres://dev:dev@[::1]:5433/peopleflow_vacancies?sslmode=disable",
	} {
		if err := CheckDatabaseURL(dsn); err != nil {
			t.Errorf("%s: %v", dsn, err)
		}
	}
	for name, dsn := range map[string]string{
		"empty":             "",
		"remote host":       "postgres://dev:dev@db.example.com:5432/peopleflow_vacancies",
		"private address":   "postgres://dev:dev@10.0.0.5:5432/peopleflow_vacancies",
		"other loopback":    "postgres://dev:dev@127.0.0.2:5432/peopleflow_vacancies",
		"test database":     "postgres://draft_test:draft_test@127.0.0.1:55432/draft_test?sslmode=disable",
		"similar name":      "postgres://dev:dev@127.0.0.1/peopleflow_vacancies_copy",
		"no database":       "postgres://dev:dev@127.0.0.1:5432/",
		"no host":           "postgres:///peopleflow_vacancies",
		"keyword dsn":       "host=127.0.0.1 dbname=peopleflow_vacancies user=dev",
		"other scheme":      "mysql://dev:dev@127.0.0.1/peopleflow_vacancies",
		"host override":     "postgres://dev:dev@127.0.0.1/peopleflow_vacancies?host=db.example.com",
		"database override": "postgres://dev:dev@127.0.0.1/peopleflow_vacancies?dbname=prod",
		"service file":      "postgres://dev:dev@127.0.0.1/peopleflow_vacancies?service=prod",
		"multiple hosts":    "postgres://dev:dev@127.0.0.1,db.example.com/peopleflow_vacancies",
	} {
		if err := CheckDatabaseURL(dsn); err == nil {
			t.Errorf("%s: accepted %q", name, dsn)
		} else if strings.Contains(err.Error(), "dev:dev") {
			t.Errorf("%s: error leaks credentials: %v", name, err)
		}
	}
}

func TestCheckEnvironment(t *testing.T) {
	env := func(values map[string]string) func(string) string {
		return func(key string) string { return values[key] }
	}
	for _, values := range []map[string]string{
		{},
		{"APP_ENV": "local"},
		{"APP_ENV": " Local "},
		{"APP_ENV": "test"},
	} {
		if err := CheckEnvironment(env(values)); err != nil {
			t.Errorf("%v: %v", values, err)
		}
	}
	for _, values := range []map[string]string{
		{"APP_ENV": "production"},
		{"APP_ENV": " PRODUCTION "},
		{"APP_ENV": "prod"},
		{"APP_ENV": "staging"},
		{"APP_ENV": "local", "ENV": "production"},
		{"ENVIRONMENT": "production"},
		{"GO_ENV": "prod"},
	} {
		if err := CheckEnvironment(env(values)); err == nil {
			t.Errorf("%v: accepted", values)
		}
	}
	if err := CheckEnvironment(nil); err == nil {
		t.Error("nil getenv accepted")
	}
}

func TestDatabaseGuardNames(t *testing.T) {
	if got := LocalDatabase().Name(); got != "peopleflow_vacancies" {
		t.Fatalf("local database %q", got)
	}
	if got := TestOnlyDatabase("draft_test").Name(); got != "draft_test" {
		t.Fatalf("test database %q", got)
	}
}
