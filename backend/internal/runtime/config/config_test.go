package config_test

import (
	"testing"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/runtime/config"
)

func TestDefaultServerConfig(t *testing.T) {
	c := config.DefaultServerConfig(":8080")
	if c.Addr != ":8080" {
		t.Errorf("Addr = %q, want :8080", c.Addr)
	}
	for _, p := range []struct {
		name string
		got  time.Duration
		want time.Duration
	}{
		{"read_header", c.ReadHeaderTimeout, 5 * time.Second},
		{"read", c.ReadTimeout, 10 * time.Second},
		{"write", c.WriteTimeout, 30 * time.Second},
		{"idle", c.IdleTimeout, 120 * time.Second},
		{"readiness", c.ReadinessTimeout, 2 * time.Second},
		{"drain", c.DrainTimeout, 10 * time.Second},
	} {
		if p.got != p.want {
			t.Errorf("default %s = %v, want %v", p.name, p.got, p.want)
		}
	}
}
func TestServerConfig_Validate(t *testing.T) {
	base := config.DefaultServerConfig(":8080")
	if err := base.Validate(); err != nil {
		t.Fatalf("Validate(all positive) = %v, want nil", err)
	}
	for _, tc := range []struct {
		name string
		mut  func(*config.ServerConfig)
	}{
		{"zero read_header", func(c *config.ServerConfig) { c.ReadHeaderTimeout = 0 }},
		{"zero read", func(c *config.ServerConfig) { c.ReadTimeout = 0 }},
		{"zero write", func(c *config.ServerConfig) { c.WriteTimeout = 0 }},
		{"zero idle", func(c *config.ServerConfig) { c.IdleTimeout = 0 }},
		{"zero readiness", func(c *config.ServerConfig) { c.ReadinessTimeout = 0 }},
		{"zero drain", func(c *config.ServerConfig) { c.DrainTimeout = 0 }},
		{"negative drain", func(c *config.ServerConfig) { c.DrainTimeout = -time.Second }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			c := base
			tc.mut(&c)
			if err := c.Validate(); err == nil {
				t.Errorf("Validate(%s) = nil, want error", tc.name)
			}
		})
	}
}
