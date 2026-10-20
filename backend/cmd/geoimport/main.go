// geoimport imports versioned reduced catalogs, or reduces manually downloaded
// sources. It intentionally does not load .env files or download anything.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/geo/infrastructure/catalog"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/geo/infrastructure/postgres"
	"github.com/jackc/pgx/v5/pgxpool"
)

func main() {
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	if err := run(ctx, os.Args[1:], os.Stdout); err != nil {
		fmt.Fprintln(os.Stderr, "geoimport:", err)
		os.Exit(1)
	}
}
func run(ctx context.Context, args []string, out io.Writer) error {
	flags := flag.NewFlagSet("geoimport", flag.ContinueOnError)
	flags.SetOutput(out)
	dir := flags.String("dir", "db/geo", "reduced CSV directory (with sources.json)")
	raw := flags.String("reduce", "", "raw source directory; reduce only, without database access")
	allow := flags.Bool("allow-orphans", false, "retain and report codes absent from incoming files")
	skipPostal := flags.Bool("skip-postal-codes", false, "import ISO/INEGI only; do not read or import SEPOMEX postal codes")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if flags.NArg() != 0 {
		return errors.New("unexpected positional arguments")
	}
	if *raw != "" {
		if *skipPostal {
			return errors.New("-skip-postal-codes only applies to imports, not reduction")
		}
		data, skipped, err := catalog.Reduce(os.DirFS(*raw))
		if err != nil {
			return err
		}
		for _, pair := range skipped {
			fmt.Fprintln(out, "skipped SEPOMEX pair:", pair)
		}
		if err = catalog.WriteCSV(*dir, data); err != nil {
			return err
		}
		fmt.Fprintf(out, "reduced countries=%d states=%d municipalities=%d postal_pairs=%d skipped=%d\n", len(data.Countries), len(data.States), len(data.Municipalities), len(data.PostalCodes), len(skipped))
		return nil
	}
	data, skipped, err := catalog.ReadCSVWithOptions(os.DirFS(*dir), catalog.Options{SkipPostalCodes: *skipPostal})
	if err != nil {
		return err
	}
	for _, pair := range skipped {
		fmt.Fprintln(out, "skipped SEPOMEX pair:", pair)
	}
	manifest, err := os.ReadFile(filepath.Join(*dir, "sources.json"))
	if err != nil {
		return err
	}
	var sources []postgres.Source
	if err = json.Unmarshal(manifest, &sources); err != nil {
		return err
	}
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		return errors.New("DATABASE_URL must be supplied explicitly; no .env is loaded")
	}
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		return errors.New("invalid database configuration")
	}
	cfg.MaxConns = 1
	cfg.ConnConfig.ConnectTimeout = 10 * time.Second
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return errors.New("cannot open database")
	}
	defer pool.Close()
	report, err := postgres.ImportWithOptions(ctx, pool, data, sources, postgres.ImportOptions{AllowOrphans: *allow, SkipPostalCodes: *skipPostal})
	for _, code := range report.Orphans {
		fmt.Fprintln(out, "retained orphan:", code)
	}
	if err != nil {
		var orphan *postgres.OrphanError
		if errors.As(err, &orphan) {
			return errors.New("orphan check refused import; review missing codes before using -allow-orphans")
		}
		return errors.New("import failed; catalog transaction rolled back (check database availability, migration 00030 and source manifest)")
	}
	fmt.Fprintf(out, "imported countries=%d states=%d municipalities=%d postal_pairs=%d skipped=%d retained_orphans=%d postal_step_skipped=%t\n", report.Counts["countries.csv"], report.Counts["mx_states.csv"], report.Counts["mx_municipalities.csv"], report.Counts["mx_postal_codes.csv"], len(skipped)+len(report.Skipped), len(report.Orphans), *skipPostal)
	return nil
}
