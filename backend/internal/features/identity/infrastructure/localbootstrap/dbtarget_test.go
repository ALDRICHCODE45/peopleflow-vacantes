package localbootstrap

import "testing"

func TestParseDatabaseTarget(t *testing.T) {
	tests := []struct {
		name    string
		dsn     string
		wantOK  bool
		host    string
		port    string
		dbName  string
		leak    string
		display string
	}{
		{
			name:    "loopback ipv4 with credentials",
			dsn:     "postgres://admin:super-secret@127.0.0.1:5432/peopleflow_vacancies",
			wantOK:  true,
			host:    "127.0.0.1",
			port:    "5432",
			dbName:  "peopleflow_vacancies",
			display: "127.0.0.1:5432/peopleflow_vacancies",
		},
		{
			name:   "localhost alias",
			dsn:    "postgresql://user@localhost:5432/local_db",
			wantOK: true,
			host:   "localhost",
			port:   "5432",
			dbName: "local_db",
		},
		{
			name:   "ipv6 loopback",
			dsn:    "postgres://u@[::1]:5432/local_db",
			wantOK: true,
			host:   "::1",
			port:   "5432",
			dbName: "local_db",
		},
		{name: "remote host rejected", dsn: "postgres://u:remote-secret@db.example.com:5432/local_db", leak: "remote-secret"},
		{name: "multi host rejected", dsn: "postgres://u@127.0.0.1:5432,10.0.0.5:5432/local_db"},
		{name: "host query override rejected", dsn: "postgres://u@127.0.0.1:5432/local_db?host=evil.example.com", leak: "evil.example.com"},
		{name: "hostaddr query override rejected", dsn: "postgres://u@127.0.0.1:5432/local_db?hostaddr=10.0.0.5"},
		{name: "service query rejected", dsn: "postgres://u@127.0.0.1:5432/local_db?service=prod"},
		{name: "servicefile query rejected", dsn: "postgres://u@127.0.0.1:5432/local_db?servicefile=/tmp/pg_service.conf"},
		{name: "passfile query rejected", dsn: "postgres://u@127.0.0.1:5432/local_db?passfile=/tmp/pgpass"},
		{name: "missing host rejected", dsn: "postgres:///local_db"},
		{name: "keyword dsn rejected", dsn: "host=127.0.0.1 dbname=local_db"},
		{name: "non postgres scheme rejected", dsn: "mysql://u@127.0.0.1:3306/local_db"},
		{name: "missing database name rejected", dsn: "postgres://u@127.0.0.1:5432/"},
		{name: "empty rejected", dsn: ""},
		{name: "whitespace rejected", dsn: "   "},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			target, err := ParseDatabaseTarget(tt.dsn)

			if !tt.wantOK {
				if err == nil {
					t.Fatalf("ParseDatabaseTarget(%q) = nil error, want a safe rejection", tt.dsn)
				}
				if tt.leak != "" && leaks(err.Error(), tt.leak) {
					t.Errorf("error leaks %q: %q", tt.leak, err.Error())
				}
				if err != nil && leaks(err.Error(), tt.dsn) && tt.dsn != "" {
					t.Errorf("error echoes the raw DSN: %q", err.Error())
				}
				return
			}
			if err != nil {
				t.Fatalf("ParseDatabaseTarget returned error: %v", err)
			}
			if target.Host != tt.host || target.Port != tt.port || target.Name != tt.dbName {
				t.Errorf("target = %+v, want host=%q port=%q name=%q", target, tt.host, tt.port, tt.dbName)
			}
			if tt.display != "" && target.Display() != tt.display {
				t.Errorf("Display() = %q, want %q", target.Display(), tt.display)
			}
			if target.Display() == "" {
				t.Errorf("Display() must not be empty")
			}
		})
	}
}

func TestDatabaseTarget_Display_NoCredentials(t *testing.T) {
	target, err := ParseDatabaseTarget("postgres://admin:super-secret@127.0.0.1:5432/peopleflow_vacancies")
	if err != nil {
		t.Fatalf("ParseDatabaseTarget: %v", err)
	}
	if leaks(target.Display(), "super-secret") || leaks(target.Display(), "admin") {
		t.Errorf("Display() leaks credentials: %q", target.Display())
	}
}
