// Package migrations embeds the goose SQL migrations so the deployed binary
// carries its schema history with no working-directory dependency (design D3).
package migrations

import (
	"embed"
	"io/fs"
)

// migrationsFS is embedded at build time; the go:embed directive must live
// beside the SQL files so parent-directory patterns stay illegal.
//
//go:embed *.sql
var migrationsFS embed.FS

// MigrationsFS is the read-only filesystem of `*.sql` migrations consumed by
// cmd/migrate via goose's base FS.
var MigrationsFS fs.FS = migrationsFS
