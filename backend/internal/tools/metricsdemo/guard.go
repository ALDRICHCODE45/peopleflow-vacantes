package metricsdemo

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// LocalDatabaseName is the only database the command writes.
const LocalDatabaseName = "peopleflow_vacancies"

// overrideParams are the URL query parameters that could move the connection
// to another host or database, or resolve one from a file.
var overrideParams = []string{"host", "hostaddr", "port", "dbname", "database", "service", "servicefile", "passfile", "target_session_attrs"}

// CheckDatabaseURL accepts only a postgres URL whose host is literally
// 127.0.0.1, localhost or ::1 and whose database is exactly
// peopleflow_vacancies. It runs before any connection is opened; errors never
// echo the URL (it carries the password).
func CheckDatabaseURL(dsn string) error {
	if strings.TrimSpace(dsn) == "" {
		return errors.New("DATABASE_URL is required")
	}
	u, err := url.Parse(dsn)
	if err != nil || (u.Scheme != "postgres" && u.Scheme != "postgresql") {
		return errors.New("DATABASE_URL must be a postgres:// URL")
	}
	if strings.Contains(u.Host, ",") {
		return errors.New("DATABASE_URL must name a single host")
	}
	switch u.Hostname() {
	case "127.0.0.1", "localhost", "::1":
	default:
		return fmt.Errorf("refusing host %q: only 127.0.0.1, localhost or ::1", u.Hostname())
	}
	query := u.Query()
	for _, name := range overrideParams {
		if _, ok := query[name]; ok {
			return fmt.Errorf("DATABASE_URL must not set the %q parameter", name)
		}
	}
	if name := strings.TrimPrefix(u.Path, "/"); name != LocalDatabaseName {
		return fmt.Errorf("refusing database %q: only %s", name, LocalDatabaseName)
	}
	// pgx must read the same target (no fallback host, no environment default).
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		return errors.New("DATABASE_URL cannot be parsed")
	}
	if cfg.ConnConfig.Database != LocalDatabaseName || cfg.ConnConfig.Host != u.Hostname() {
		return errors.New("DATABASE_URL resolves to another target")
	}
	// sslmode=prefer adds a plain-text fallback to the same host; never another host.
	for _, fallback := range cfg.ConnConfig.Fallbacks {
		if fallback.Host != u.Hostname() {
			return errors.New("DATABASE_URL resolves to another target")
		}
	}
	return nil
}

// productionMarkers are the environment variables that can mark production.
// APP_ENV is the one the API reads (production | local | test).
var productionMarkers = []string{"APP_ENV", "ENV", "ENVIRONMENT", "GO_ENV"}

// CheckEnvironment refuses to run when any marker says production, and when
// APP_ENV holds anything but empty, local or test.
func CheckEnvironment(getenv func(string) string) error {
	if getenv == nil {
		return errors.New("environment lookup is required")
	}
	for _, key := range productionMarkers {
		switch strings.ToLower(strings.TrimSpace(getenv(key))) {
		case "production", "prod":
			return fmt.Errorf("refusing to run: %s marks production", key)
		}
	}
	switch strings.ToLower(strings.TrimSpace(getenv("APP_ENV"))) {
	case "", "local", "test":
		return nil
	default:
		return errors.New("refusing to run: APP_ENV must be empty, local or test")
	}
}

// Database is the database name Apply and Remove insist on before writing,
// checked on the open connection (current_database()).
type Database struct{ name string }

// Name is the expected database name.
func (d Database) Name() string { return d.name }

// LocalDatabase is the development database, the command's only target.
func LocalDatabase() Database { return Database{name: LocalDatabaseName} }

// TestOnlyDatabase lets the integration test run Apply and Remove on its own
// isolated database. The command never calls it.
func TestOnlyDatabase(name string) Database { return Database{name: name} }

// verify checks the connection's database before any write.
func (d Database) verify(ctx context.Context, tx pgx.Tx) error {
	var name string
	if err := tx.QueryRow(ctx, `SELECT current_database()`).Scan(&name); err != nil {
		return fmt.Errorf("read current database: %w", err)
	}
	if d.name == "" || name != d.name {
		return fmt.Errorf("refusing database %q: expected %q", name, d.name)
	}
	return nil
}
