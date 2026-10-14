package localbootstrap

import (
	"errors"
	"net"
	"net/url"
	"strings"
)

// DatabaseTarget is the validated local database connection target. Only the
// host alias, port and database name are retained so the private terminal can
// display them without exposing the DSN or credentials.
type DatabaseTarget struct {
	Host string
	Port string
	Name string
}

// Display returns the human-readable local target shown in the private
// terminal (host:port/name). It never contains credentials or the DSN.
func (t DatabaseTarget) Display() string {
	return t.Host + ":" + t.Port + "/" + t.Name
}

// indirectionParams are the libpq/pgx URL query parameters that could override
// the displayed host or resolve a credential/service file.
// Reject their presence, even when blank, before opening any connection.
var indirectionParams = []string{
	"host", "hostaddr", "service", "servicefile", "passfile", "target_session_attrs",
}

// ParseDatabaseTarget validates that DATABASE_URL points at an explicit local
// database before any connection is opened. It rejects non-Postgres schemes,
// remote or multi-host targets, missing hosts (which would let libpq fall back
// to PGHOST), and every target override or environmental indirection parameter.
func ParseDatabaseTarget(dsn string) (DatabaseTarget, error) {
	if strings.TrimSpace(dsn) == "" {
		return DatabaseTarget{}, errors.New("local bootstrap: DATABASE_URL is required")
	}
	u, err := url.Parse(dsn)
	if err != nil {
		return DatabaseTarget{}, errors.New("local bootstrap: DATABASE_URL must be a valid URL")
	}
	scheme := strings.ToLower(u.Scheme)
	if scheme != "postgres" && scheme != "postgresql" {
		return DatabaseTarget{}, errors.New("local bootstrap: DATABASE_URL must use the postgres scheme")
	}
	if u.Host == "" {
		return DatabaseTarget{}, errors.New("local bootstrap: DATABASE_URL must declare an explicit host")
	}
	if strings.Contains(u.Host, ",") {
		return DatabaseTarget{}, errors.New("local bootstrap: DATABASE_URL must not declare multiple hosts")
	}
	query := u.Query()
	for _, name := range indirectionParams {
		if _, ok := query[name]; ok {
			return DatabaseTarget{}, errors.New("local bootstrap: DATABASE_URL must not use environmental indirection parameters")
		}
	}
	for _, name := range []string{"dbname", "database", "port"} {
		if _, ok := query[name]; ok {
			return DatabaseTarget{}, errors.New("local bootstrap: DATABASE_URL must not use target override parameters")
		}
	}
	host := u.Hostname()
	if !isLoopbackHost(host) {
		return DatabaseTarget{}, errors.New("local bootstrap: DATABASE_URL must point at a loopback host")
	}
	port := u.Port()
	if port == "" {
		port = "5432"
	}
	name := strings.TrimPrefix(u.Path, "/")
	if name == "" {
		return DatabaseTarget{}, errors.New("local bootstrap: DATABASE_URL must name a database")
	}
	return DatabaseTarget{Host: host, Port: port, Name: name}, nil
}

// isLoopbackHost accepts a literal loopback IP or the localhost alias.
func isLoopbackHost(host string) bool {
	if strings.EqualFold(host, "localhost") {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}
