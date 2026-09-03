// Package config holds typed runtime configuration for the HTTP server.
package config

import (
	"errors"
	"time"
)

// ServerConfig is the typed server/health timeout configuration.
type ServerConfig struct {
	Addr              string
	ReadHeaderTimeout time.Duration
	ReadTimeout       time.Duration
	WriteTimeout      time.Duration
	IdleTimeout       time.Duration
	ReadinessTimeout  time.Duration
	DrainTimeout      time.Duration
}

// DefaultServerConfig returns the conservative baseline configuration.
func DefaultServerConfig(addr string) ServerConfig {
	return ServerConfig{
		Addr:              addr,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       120 * time.Second,
		ReadinessTimeout:  2 * time.Second,
		DrainTimeout:      10 * time.Second,
	}
}

// Validate requires every timeout to be strictly positive.
func (c ServerConfig) Validate() error {
	for _, d := range [6]time.Duration{c.ReadHeaderTimeout, c.ReadTimeout, c.WriteTimeout, c.IdleTimeout, c.ReadinessTimeout, c.DrainTimeout} {
		if d <= 0 {
			return errors.New("config: every timeout must be > 0")
		}
	}
	return nil
}
