package testsupport

import "testing"

func TestValidateEndpoint(t *testing.T) {
	for _, tc := range []struct {
		name, env, endpoint string
		invalid             bool
	}{
		{"unset", "local", "", false},
		{"ipv4", "local", "http://127.0.0.1:9000", false},
		{"localhost", "local", "http://localhost:9000", false},
		{"ipv6", "local", "http://[::1]:9000", false},
		{"production", "production", "http://127.0.0.1:9000", true},
		{"production unset", "production", "", true},
		{"remote", "local", "https://s3.amazonaws.com", true},
		{"lookalike", "local", "http://localhost.example.com", true},
		{"credentials", "local", "http://secret@localhost", true},
		{"path", "local", "http://localhost/bucket", true},
		{"query", "local", "http://localhost?secret", true},
		{"fragment", "local", "http://localhost#secret", true},
		{"scheme", "local", "file://localhost", true},
		{"malformed", "local", "://secret", true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if err := ValidateEndpoint(tc.env, tc.endpoint); (err != nil) != tc.invalid {
				t.Fatalf("err=%v invalid=%v", err, tc.invalid)
			}
		})
	}
}
